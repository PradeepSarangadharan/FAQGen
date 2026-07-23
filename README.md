# FAQGen — FAQ Schema Generator & HEIC to JPG Converter

A free, client-side toolset. The FAQ generator produces `FAQPage` JSON-LD structured
data, similar to
[saijogeorge.com/json-ld-schema-generator/faq](https://saijogeorge.com/json-ld-schema-generator/faq/).
The HEIC to JPG converter converts iPhone photos to JPG entirely in the browser, similar to
[iloveimg.com/convert-to-jpg/heic-to-jpg](https://www.iloveimg.com/convert-to-jpg/heic-to-jpg).

## FAQ Schema Generator (`index.html`)

- Add, edit, remove, and drag-to-reorder question/answer pairs
- Live JSON-LD `<script>` preview as you type
- Validation warnings (missing answers, duplicate questions, HTML in answers)
- One-click copy or download of the generated schema
- Import mode: paste FAQ HTML and auto-extract question/answer pairs
- Autosaves your work to `localStorage` so a page refresh doesn't lose it

Open `index.html` in a browser (or serve the folder with any static file server).
Fill in your questions and answers, copy the generated JSON-LD, and paste it into
the `<head>` or `<body>` of the page that visibly displays that FAQ content.
Validate with [Google's Rich Results Test](https://search.google.com/test/rich-results).

## HEIC to JPG Converter (`heic-to-jpg.html`)

- Drag-and-drop or file-picker upload of one or more `.heic`/`.heif` files
- Adjustable JPG output quality
- Convert files individually or all at once
- Per-file preview thumbnail and download link
- Download all converted files at once as a ZIP
- Runs 100% client-side via WebAssembly (`heic2any`) — photos are never uploaded anywhere

Open `heic-to-jpg.html` in a browser, add your HEIC photos, and convert. Everything
happens locally in the browser tab.

## Tech notes

No build step for the app's own code — plain HTML/CSS/JS. The HEIC converter loads
two small third-party libraries from a CDN at runtime: `heic2any` (HEIC/HEIF decoding)
and `JSZip` (bundling multiple downloads into one ZIP).
