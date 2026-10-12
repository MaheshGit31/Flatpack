export interface Scene { id: string; title: string; activity: string; html: string; sensitive?: boolean; blocklisted?: boolean }
export const SCENES: Scene[];
export const VARIANTS: { id: string; css: string }[];
