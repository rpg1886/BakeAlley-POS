/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_RETAIL_TIER_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}