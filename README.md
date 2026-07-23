# FAQGen — FAQ Schema Generator & PDF Editor

A free, client-side toolset. It started as an `FAQPage` JSON-LD structured data
generator, similar to
[saijogeorge.com/json-ld-schema-generator/faq](https://saijogeorge.com/json-ld-schema-generator/faq/),
and now also includes a browser-based PDF editor, similar to
[iLovePDF's Edit PDF tool](https://www.ilovepdf.com/edit-pdf).

## FAQ Schema Generator (`index.html`)

- Add, edit, remove, and drag-to-reorder question/answer pairs
- Live JSON-LD `<script>` preview as you type
- Validation warnings (missing answers, duplicate questions, HTML in answers)
- One-click copy or download of the generated schema
- Import mode: paste FAQ HTML and auto-extract question/answer pairs
- Autosaves your work to `localStorage` so a page refresh doesn't lose it

### Usage

Open `index.html` in a browser (or serve the folder with any static file server).
Fill in your questions and answers, copy the generated JSON-LD, and paste it into
the `<head>` or `<body>` of the page that visibly displays that FAQ content.
Validate with [Google's Rich Results Test](https://search.google.com/test/rich-results).

## PDF Editor (`pdf-editor/`)

A fully standalone tool — it doesn't share styling or navigation with the FAQ
generator, and the whole `pdf-editor/` folder can be copied to and hosted from
any location on its own (e.g. a subfolder of another site). Open, edit, and
download PDF files entirely in the browser — nothing is uploaded to a server.

- **Edit existing text** — click any text on the page and retype it in place
  (the original text is covered and the replacement is drawn over it)
- **Add text** — place new text boxes with adjustable font size, color, bold/italic
- **Add images** — upload a PNG/JPG and place, move, and resize it on the page
- **Shapes** — rectangle, ellipse, line, and arrow, with stroke/fill/opacity controls
- **Highlight** — drag over text to add a translucent highlight
- **Comments** — drop sticky-note style comments anywhere on the page
- Select/move/resize/delete any added object, undo (Ctrl+Z), page navigation, zoom
- Exports a real edited PDF (via [pdf-lib](https://pdf-lib.js.org/)) that you download directly

### Usage

Open `pdf-editor/index.html`, drag a PDF in (or choose a file), edit it with the
toolbar, then click **Download PDF**. To deploy it elsewhere, copy the entire
`pdf-editor/` folder (it's self-contained, including its own CSS and the
vendored libraries) to the target location.

## Tech notes

Both tools are plain HTML/CSS/JS with no build step. The PDF editor uses
[pdf.js](https://mozilla.github.io/pdf.js/) (for rendering and text-layer editing)
and [pdf-lib](https://pdf-lib.js.org/) (for producing the edited PDF), vendored
as static files under `pdf-editor/vendor/` so the tool works fully offline with
no CDN dependency.
