// Each excerpt retains its original line position so the preview includes omitted context.
function patch(hunks: { start: number; lines: string }[]) {
  let offset = 0;
  return hunks
    .map(({ start, lines }) => {
      const rows = lines.split("\n");
      const removed = rows.filter((line) => line.startsWith("-")).length;
      const added = rows.filter((line) => line.startsWith("+")).length;
      const before = rows.length - added;
      const after = rows.length - removed;
      const header = `@@ -${start},${before} +${start + offset},${after} @@`;
      offset += added - removed;
      return `${header}\n${lines}\n`;
    })
    .join("");
}

export const paginationDiffFiles = [
  {
    path: "web/src/components/NotesFeed.tsx",
    diff: patch([
      {
        start: 18,
        lines: ` type NotesFeedProps = {
   notebookId: string;
   pageSize?: number;
+  onNoteOpen?: (noteId: string) => void;
 };
 
-export function NotesFeed({ notebookId, pageSize = 10 }: NotesFeedProps) {
+export function NotesFeed({ notebookId, pageSize = 50, onNoteOpen }: NotesFeedProps) {
   const [cursor, setCursor] = useState<string | null>(null);
   const [notes, setNotes] = useState<Note[]>([]);`,
      },
      {
        start: 94,
        lines: `   const loadMore = useCallback(async () => {
     setLoading(true);
     const page = await fetchNotes({ notebookId, cursor, limit: pageSize });
-    setNotes((previous) => [...previous, ...page.notes]);
+    setNotes((previous) => {
+      const knownIds = new Set(previous.map((note) => note.id));
+      return [...previous, ...page.notes.filter((note) => !knownIds.has(note.id))];
+    });
     setCursor(page.nextCursor);
     setLoading(false);
   }, [notebookId, cursor, pageSize]);`,
      },
      {
        start: 182,
        lines: `   return (
-    <section className="notes-feed">
+    <section className="notes-feed" aria-label="Notes" aria-busy={loading}>
       {notes.map((note) => (
-        <NoteCard key={note.createdAt} note={note} />
+        <NoteCard key={note.id} note={note} onOpen={onNoteOpen} />
       ))}
-      <button onClick={loadMore}>Load more</button>
+      <button className="notes-feed__more" onClick={loadMore} disabled={loading}>
+        {loading ? "Loading notes…" : "Load more"}
+      </button>
+      <span className="sr-only" role="status">{notes.length} notes loaded</span>
     </section>
   );
 }`,
      },
    ]),
  },
  {
    path: "web/src/styles/notes.css",
    diff: patch([
      {
        start: 27,
        lines: ` .notes-feed {
   display: grid;
-  gap: 8px;
-  grid-template-columns: repeat(3, 1fr);
+  gap: 12px;
+  grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
   padding: 16px;
+  overflow-anchor: none;
 }`,
      },
      {
        start: 116,
        lines: ` .notes-feed__more {
   grid-column: 1 / -1;
-  color: #777777;
-  padding: 16px 24px;
+  color: var(--text-secondary, #a3a3a3);
+  padding: 8px 16px;
   border-radius: 8px;
+  transition: background-color 120ms ease;
+}
+
+.notes-feed__more:disabled {
+  cursor: wait;
+  opacity: 0.6;
 }`,
      },
      {
        start: 243,
        lines: ` @media (prefers-reduced-motion: reduce) {
   .note-card {
     animation: none;
   }
+
+  .notes-feed__more {
+    transition: none;
+  }
 }`,
      },
    ]),
  },
  {
    path: "web/index.html",
    diff: patch([
      {
        start: 4,
        lines: ` <head>
   <meta charset="UTF-8" />
   <meta name="viewport" content="width=device-width, initial-scale=1" />
-  <meta name="theme-color" content="#f6f5f1" />
+  <meta name="theme-color" content="#171717" />
+  <meta name="color-scheme" content="dark light" />
   <title>Fieldnotes</title>
   <link rel="icon" href="/favicon.svg" />`,
      },
      {
        start: 68,
        lines: ` <body>
-  <div id="root"></div>
+  <div id="root" role="main"></div>
   <noscript>
-    <p>Please enable JavaScript.</p>
+    <p>Enable JavaScript to browse and search your notes.</p>
   </noscript>
   <script type="module" src="/src/main.tsx"></script>`,
      },
    ]),
  },
];
