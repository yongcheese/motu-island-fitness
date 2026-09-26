/// <reference types="vite/client" />

// Pulls in Vite's ambient types, chiefly `import.meta.env` (DEV/PROD/MODE).
// Added when Scene.tsx started gating the z-fighting scene audit on
// `import.meta.env.DEV` so the tool ships only in dev builds.
