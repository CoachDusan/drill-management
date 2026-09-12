# Vendored libraries

Copied into the repository on purpose: the app has no build step and must work
with no internet, so nothing may load from a CDN at runtime. Loaded only when
a PDF report is made (see `js/pdf.js`), and cached for offline use by `sw.js`.

| File | Library | Version | Licence | Source |
|---|---|---|---|---|
| `jspdf.umd.min.js` | jsPDF | 4.2.1 | MIT | https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js |
| `jspdf.plugin.autotable.min.js` | jsPDF-AutoTable | 5.0.8 | MIT | https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/5.0.8/jspdf.plugin.autotable.min.js |

Both were checked against cdnjs's published SHA-512 hashes when downloaded:

    jspdf.umd.min.js                sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg==
    jspdf.plugin.autotable.min.js   sha512-QLh0AACvI+3C+bmn3QdH6blN0NWBxwGvBDgV67TvKV5Q2knO9+/+lguVL23JQ9DR7CnfuOSYUBURlXjmJeK11Q==

To upgrade: download the new files, check them against the hashes cdnjs
publishes (`https://api.cdnjs.com/libraries/<name>/<version>?fields=sri`),
update this table, bump `VERSION` in `sw.js`, and run `tests/pdf.test.js`.
