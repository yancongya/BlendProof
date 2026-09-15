import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { EN } from './en'

export type Lang = 'zh' | 'en'

// Collapse whitespace so dictionary keys written with decorative spaces
// (e.g. '容量 ' next to a dynamic value, '已运行 ') still match the exact
// text node value produced by React.
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

// Normalized lookup so both `t()` and the overlay resolve keys regardless of
// stray whitespace differences between source text and dictionary keys.
const EN_LOOKUP: Record<string, string> = {}
for (const rawKey in EN) {
  EN_LOOKUP[normalize(rawKey)] = EN[rawKey as keyof typeof EN]
}

const STORAGE_KEY = 'bp-lang'

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    /* private mode: language just won't persist */
  }
  return 'zh'
}

// Module-level mirror so non-React helpers (date formatting) can read the
// active language without going through the hook.
let currentLang: Lang = readInitialLang()
export function getLang(): Lang {
  return currentLang
}

interface I18nValue {
  lang: Lang
  setLang: (next: Lang) => void
  toggle: () => void
}

const I18nContext = createContext<I18nValue>({
  lang: currentLang,
  setLang: () => {},
  toggle: () => {},
})

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [lang, setLangState] = useState<Lang>(currentLang)

  const setLang = (next: Lang): void => {
    currentLang = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    setLangState(next)
  }

  const toggle = (): void => setLang(lang === 'zh' ? 'en' : 'zh')

  return (
    <I18nContext.Provider value={{ lang, setLang, toggle }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}

/** Imperative translate helper for code that builds strings outside JSX. */
export function t(zh: string): string {
  if (currentLang === 'en') return EN_LOOKUP[normalize(zh)] ?? zh
  return zh
}

/** Translate a template with %s placeholders, used for composed strings that
 *  embed dynamic data (dates, object names) and can't be a static key. */
export function tf(zhTemplate: string, ...args: Array<string | number>): string {
  const template = currentLang === 'en' ? EN_LOOKUP[normalize(zhTemplate)] ?? zhTemplate : zhTemplate
  let i = 0
  return template.replace(/%s/g, () => String(args[i++] ?? ''))
}

const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'] as const
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'])

/**
 * Translates the whole document in place and keeps it in sync as React adds or
 * updates nodes. Chinese stays the no-JS / crawler source; switching to English
 * overlays the dictionary and switching back restores the original.
 */
export function I18nLayer(): ReactNode {
  const { lang } = useI18n()
  const originals = useRef<WeakMap<Node, string>>(new WeakMap())

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  }, [lang])

  useLayoutEffect(() => {
    const map = originals.current
    applyDocument(lang, map)

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          translateText(mutation.target as Text, lang, map)
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) translateText(node as Text, lang, map)
            else if (node.nodeType === Node.ELEMENT_NODE) applySubtree(node as Element, lang, map)
          })
        } else if (mutation.type === 'attributes') {
          const el = mutation.target as Element
          if (el.closest('[data-i18n-ignore]')) continue
          const attr = mutation.attributeName
          if (attr && (ATTRS as readonly string[]).includes(attr)) {
            translateAttr(el, attr, lang, map)
          }
        }
      }
    })

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS as unknown as string[],
    })

    return () => observer.disconnect()
  }, [lang])

  return null
}

function applyDocument(lang: Lang, map: WeakMap<Node, string>): void {
  const texts: Text[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (shouldSkipTextNode(node)) continue
    texts.push(node)
  }
  for (const node of texts) translateText(node, lang, map)

  document
    .querySelectorAll<HTMLElement>('body [title], body [aria-label], body [placeholder], body [alt]')
    .forEach((el) => {
      if (el.closest('[data-i18n-ignore]')) return
      for (const attr of ATTRS) translateAttr(el, attr, lang, map)
    })
}

function applySubtree(root: Element, lang: Lang, map: WeakMap<Node, string>): void {
  if (root.closest('[data-i18n-ignore]')) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (shouldSkipTextNode(node)) continue
    translateText(node, lang, map)
  }
  for (const attr of ATTRS) translateAttr(root, attr, lang, map)
}

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement
  if (!parent) return true
  if (SKIP_TAGS.has(parent.tagName)) return true
  if (parent.closest('[data-i18n-ignore]')) return true
  return false
}

function translateText(node: Text, lang: Lang, map: WeakMap<Node, string>): void {
  const current = node.nodeValue ?? ''
  if (lang === 'en') {
    if (!/[一-鿿]/.test(current)) return
    if (!map.has(node)) map.set(node, current)
    const en = EN_LOOKUP[normalize(current)]
    if (en !== undefined) node.nodeValue = en
  } else if (map.has(node)) {
    node.nodeValue = map.get(node) as string
    map.delete(node)
  }
}

function translateAttr(
  el: Element,
  attr: string,
  lang: Lang,
  map: WeakMap<Node, string>,
): void {
  const value = el.getAttribute(attr)
  if (!value) return
  if (lang === 'en') {
    if (!/[一-鿿]/.test(value)) return
    if (!map.has(el)) map.set(el, value)
    const en = EN_LOOKUP[normalize(value)]
    if (en !== undefined) el.setAttribute(attr, en)
  } else if (map.has(el)) {
    el.setAttribute(attr, map.get(el) as string)
    map.delete(el)
  }
}
