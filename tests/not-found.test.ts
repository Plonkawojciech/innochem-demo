import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NotFound from "../app/not-found";

test("the shared missing page explains the error in Polish and provides a catalog link", () => {
  const html = renderToStaticMarkup(createElement(NotFound));
  assert.match(html, /<main/);
  assert.match(html, /aria-labelledby="not-found-title"/);
  assert.match(
    html,
    /<h1[^>]*id="not-found-title"[^>]*>Nie znaleziono strony<\/h1>/,
  );
  assert.match(html, /Ta strona lub produkt nie są dostępne/);
  assert.match(html, /<a[^>]*href="\/katalog"[^>]*>Przejdź do katalogu<\/a>/);
  assert.doesNotMatch(html, /This page could not be found/);
});
