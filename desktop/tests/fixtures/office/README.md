# Office parser fixtures

Office integration tests generate minimal DOCX/PPTX/XLSX packages in their temporary directory and pass them through the production parser. Binary fixtures are intentionally not duplicated in the repository.

Real-document qualification uses the deterministic, content-hash-sorted private corpus selected by `scripts/evals/anydoc-office/run.mts`. Evidence records only hash prefixes, extension, byte size, magic signature, stable status/code and aggregate metrics; it never records private file names, paths or document text.

Legacy `.doc`, `.ppt`, `.xls`, macro-enabled files and mislabeled OLE2 samples come from the private corpus. A platform/package cannot be release-qualified when its required real-format or packaged-app smoke sample is unavailable.
