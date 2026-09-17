/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKER_API_ORIGIN?: string;
  readonly VITE_LOCAL_BRIDGE_ORIGIN?: string;
}
declare module "*?worker" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}
