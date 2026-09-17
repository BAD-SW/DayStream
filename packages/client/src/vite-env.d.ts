/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed API origin (e.g. the Render URL) — unset locally, where the Vite dev
   * server's own proxy forwards relative /api/* calls to the local server instead. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// CSS Modules
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// Plain CSS side-effect imports
declare module '*.css';
