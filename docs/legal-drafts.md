# Legal content review

The information-page seed creates editable drafts. It never approves checkout, chooses delivery prices or selects a payment operator. Draft legal pages are visible only with STOREFRONT_PREVIEW enabled. Historical WordPress drafts remain hidden.

Before launch, the owner must complete the marked fields and approve the resulting documents. Saving an approval records an immutable version of all five documents and the commercial configuration. Editing a legal page disables checkout approval. Reusing a version with changed content is rejected. Each new order references its accepted revision, includes the text in the queued confirmation and provides an authenticated download. Historical imported orders do not falsely acquire a new legal version.

Sources consulted on 2026-09-23:

- [Polish Consumer Rights Act, consolidated text](https://eli.gov.pl/api/acts/DU/2024/1796/text.html): withdrawal and distance contracts. Check subsequent amendments as part of the final legal review.
- [UOKiK: non-conformity of goods](https://prawakonsumenta.uokik.gov.pl/reklamacja/niezgodnosc/): complaint remedies and response time.
- [UODO: data-subject rights](https://uodo.gov.pl/pl/493/2254): privacy information and rights.
- [Directive (EU) 2023/2673](https://eur-lex.europa.eu/eli/dir/2023/2673/oj): online withdrawal function. Polish implementation and the final applicable requirements still require verification.

The old site's ten-day withdrawal clause and historical delivery/payment prices were deliberately not treated as current approved conditions. There is no claim that a draft is a legally approved regulation.

The implemented `/odstapienie` flow accepts an explicit declaration after a separate review step, keeps its original text and receipt time, provides a private downloadable receipt and queues durable email confirmation. The CMS tracks handling separately from refunds and stock movements. This is technical functionality, not a conclusion that every applicable legal requirement has been verified. Include the final approved instructions and return address in the editable returns policy before launch.
