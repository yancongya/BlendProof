/**
 * 分享域唯一出口。
 *
 * 外部（pages/ 与迁移期的 legacy 目录）只能从这里引用，禁止深引用内部路径。
 */

export { SharePanel, type SharePanelProps } from "./SharePanel";
