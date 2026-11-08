# Wikihops

A little Wikipedia navigation game: start on an article, reach a target article, and try to do it in as few hops as possible.

## Run locally

```bash
npm run dev
```
Or just open `index.html` in a browser.

## How it works

Wikihops uses the English Wikipedia [MediaWiki API](https://www.mediawiki.org/wiki/API:Main_page) to find random articles, search for article suggestions, and retrieve article content. Internal article links are intercepted and counted as hops. Game state stays in the browser; there is no application backend or account system.

---
_Wikipedia text is generally available under the [Creative Commons Attribution-ShareAlike license](https://en.wikipedia.org/wiki/Wikipedia:Reusing_Wikipedia_content). Images and other media may have separate licensing terms. Wikihops is an independent project and is not affiliated with the Wikimedia Foundation._
