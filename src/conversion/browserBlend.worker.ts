/// <reference lib="webworker" />
import { convertBlendInBrowser } from "./browserBlend";

self.onmessage = async (event: MessageEvent<File | ArrayBuffer>) => {
  try {
    const result = await convertBlendInBrowser(event.data);
    self.postMessage({ type: 'success', result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
