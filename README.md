# FAQGen — FAQ Schema Generator

A free, client-side tool for generating `FAQPage` JSON-LD structured data, similar to
[saijogeorge.com/json-ld-schema-generator/faq](https://saijogeorge.com/json-ld-schema-generator/faq/).

## Features

- Add, edit, remove, and drag-to-reorder question/answer pairs
- Live JSON-LD `<script>` preview as you type
- Validation warnings (missing answers, duplicate questions, HTML in answers)
- One-click copy or download of the generated schema
- Import mode: paste FAQ HTML and auto-extract question/answer pairs
- Autosaves your work to `localStorage` so a page refresh doesn't lose it
- No build step, no dependencies — plain HTML/CSS/JS

## Usage

Open `index.html` in a browser (or serve the folder with any static file server).
Fill in your questions and answers, copy the generated JSON-LD, and paste it into
the `<head>` or `<body>` of the page that visibly displays that FAQ content.
Validate with [Google's Rich Results Test](https://search.google.com/test/rich-results).
