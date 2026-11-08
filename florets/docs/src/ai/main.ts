// Preserve links to the former AI gallery in the unified documentation.
const id = location.hash.slice(1);
location.replace(`./index.html#${id ? `ai/${encodeURIComponent(id)}` : "ai"}`);
