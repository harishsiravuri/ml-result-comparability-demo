# Known issues in the underlying data

These are issues in the frozen input files. The demo does not modify those files. Each item is a candidate fix for a future dataset release.

1. **Shared certificate identifiers.**
   - 583 `certificate_id` values are shared by 1,285 certificates in `comparability_certificates.jsonl`.
   - The leaderboard-pair identifier is `board::arxiv:value::arxiv:value`, so two methods from the same paper with the same value collide.
   - Example: on PHOENIX-2014 WER, "DDA vs DDA w/o Auto-Enc" and "pre-trained mBART vs DDA w/o Auto-Enc" share one identifier.
   - The demo keys certificates by board and both records, and notes the shared identifier in the certificate panel.
   - Suggested fix: include the method name or a record index in the identifier.

2. **Certificates are not query-conditioned.**
   - Every certificate carries `query.template = "unconditional"`, with must-agree facets split, metric surface and unit.
   - This holds whichever template the user asked.
   - The demo explains this in one line in the certificate panel.

3. **Noise band missing for leaderboard pairs.**
   - The 6,413 leaderboard-pair certificates have `uncertainty.beyond_noise = null`.
   - The frozen rule was applied to the 3,058 census pairs only.

4. **Self-inconsistent certificates.**
   - 59 census-pair certificates have `status` different from `implied_status`: 55 are comparable with implied unknown, and 4 are unknown with implied comparable.
   - All 59 are judge-traced, so the judge cause outranks the facet reading.
   - The demo does not display census-pair certificates.

5. **Metric-surface spelling splits comparison sets.**
   - Comparison sets are keyed on the raw metric surface, so `acc`, `accuracy`, `top-1 acc` and `top-1 accuracy` land in different sets, as do `f1` and `f1-score`, and `dice` and `dsc`.
   - We inspected the 57 boards where `Q_official` is conditional. Nearly all split on spelling variants of this kind. A few, for example `accuracy` vs `average accuracy`, may name genuinely different quantities.
   - The paper3.2 percent-annotation sensitivity analysis covers only the `(%)` case, which moves headline rates by under one percentage point. It does not cover these synonyms.

6. **Table pointers are positional.**
   - `table:N` is the 0-based position of a table in the parsed full text, not the paper's own table number.
   - Pointers are table-level, not cell-level.

7. **Placeholder schema identifier.**
   - `comparability_certificate.schema.json` has `$id` set to `https://github.com/PLACEHOLDER/paper3.2/...`.

8. **Hand-check findings on the worked-example candidates (Harish, 2026-10-09).**
   - Harish checked 37 displayed records against the source PDFs: **30 ok, 6 wrong_split, 1 unsure**. Every row, with the checker's notes, is in `site/data/audit/hand_audit.csv` (round 1). No frozen record was edited.
   - The six split errors:

     | Board | Record | Stored | Source says |
     |---|---|---|---|
     | PHOENIX-2014 WER | DDA w/o Auto-Enc 18.2 (2305.03614v3, Table 4) | test | dev. Its test WER is 18.8. |
     | UCF101 accuracy | DynaMotion + I3D 98.4 (2012.10671) | val | test (mean over the three official train/test splits) |
     | ICDAR2015 F1 | GWNet 89.2 (2203.05251) | not reported | test (the inference section gives test-image settings) |
     | ScanNet v2 mIoU | LSK3DNet 75.7 (2403.15173, Table 3) | test | val. Its test mIoU is 75.5. |
     | SUBJ accuracy | Fine-tuning 97.4 (2104.14690, Table 3) | not reported | test (caption: full test sets) |
     | PHOENIX14 WER | SEN 19.5 (2303.03202, Table 8) | test | dev. Its test WER is 21.0. |

   - **Unsure:** GoPro PSNR, Restormer 32.92 (2111.09881). The supplement calls the 1,111 GoPro evaluation pairs validation in prose and Test Samples in its Table 1.
   - **Recurring mechanism:** in three of the six errors (DDA w/o Auto-Enc, LSK3DNet, SEN), the paper reports dev and test values side by side and the stored value is the dev column labelled test. In the other three (UCF101, ICDAR2015 and SUBJ), the paper does state the split, but the record was labelled val or not reported.
   - **Missing records:** some papers report a test value that is absent from the board. For example, TCNet's own PHOENIX14 test WER of 18.9 (2403.11818) is not a record. A qualified answer is therefore the best *recorded* test value, which is not necessarily the best test value in the cited papers.
   - **Mixed evaluation regimes:** the SUBJ `test` records mix 10-fold cross-validation, fixed full test sets, restricted-training runs and a 500-example test sample.
   - **Preprint year:** years come from the arXiv identifier of the citing preprint. Cited results (for example TwoStream-SLR, a 2022 result) carry the citing paper's year, and later arXiv versions may change values.
   - **Scope of this check:** it covered the displayed records only. It is not a measured error rate for the corpus. But the winner-change boards it touched failed at a high rate. Eight checked boards have different naive and `Q_official` winners: PHOENIX-2014, MOT17, UCF101, GoPro, ScanNet v2, SUBJ, ActivityNet-1.3 Average mAP and PHOENIX14. Both answer records are correct on three of them: MOT17, ActivityNet-1.3 and PHOENIX14. On PHOENIX14 the change is still not genuine, because TCNet's own test value (18.9) is missing from the board. A winner change selects for label errors, because a mislabelled dev value is exactly what produces a spurious change.

9. **Hand-check findings, round 2 (Harish, 2026-10-11).**
   - Round 2 checked 19 records and answered 1 completeness question. Results: 11 ok (including the question), 5 wrong_split, 3 wrong_value and 1 missing. Every row, with the checker's notes, is in `site/data/audit/hand_audit.csv` (round 2). No frozen record was edited.
   - Wrong split:

     | Board | Record | Stored | Source says | Evidence |
     |---|---|---|---|---|
     | PASCAL VOC mIoU | SemiVL "Ours" 87.3 (2311.16241) | test | val | The paper does not name the split. The authors' evaluation code uses the val set ([eval.py](https://github.com/google-research/semivl/blob/main/third_party/unimatch/eval.py)). |
     | RTE accuracy | T5-large 82.7 (2203.05482, Appendix Table J.1) | test | val | Appendix J.4 identifies the 277-example RTE validation set. |
     | RTE accuracy | PaLM 2-L 79.3 (2305.10403, Table 2) | test | val (dev) | Established through the cited protocol: Brown et al. (2020), Appendix H, lists RTE as dev. |
     | PascalVOC-SP F1 | NeuralWalker 0.4912 (2406.03386) | not recorded | test | The table title says "Test performance". |
     | PascalVOC-SP F1 | GPS 0.3748 (2205.12454) | not recorded | test | The table title says "Test performance". |

   - Wrong value (a different benchmark or column):

     | Board | Record | Stored as | Actually |
     |---|---|---|---|
     | RTE accuracy | GPT-3 Few-Shot 92.0 (2005.14165) | RTE | COPA accuracy. GPT-3's RTE test value is 69.0. |
     | RefCOCOg accuracy | Shikra-13B 82.89 (2306.15195, Table 3) | RefCOCOg test | RefCOCO+ val. Its RefCOCOg test-u value is 83.16. |
     | RefCOCOg accuracy | Shikra-7B 80.24 (2306.15195, Table 3) | RefCOCOg test | RefCOCO test-B. Its RefCOCOg test-u value is 82.19. |

   - **Missing record:** UNINEXT-H reports RefCOCOg test-u 89.37 (2308.12966, Table 6), which is above the displayed test champion. Only its val-u 88.73 is a record.
   - **Other notes:**
     - PASCAL VOC's SAM 88.3 is correctly labelled train, but it is pseudo-mask quality and not a segmentation result. Comparing it with test-set segmentation mixes two tasks.
     - CSL-Daily: SLA-Adapter and SLA-LoRA tie at 25.8 test WER. The site shows the tie.
     - In 1901.07291, the WMT'14 En-Fr values are exact in the HTML Table 2 and rounded in the PDF.
   - **Both rounds together:**
     - 56 records were checked against the source papers. 41 had the correct value and split label. 11 had the wrong split label, 3 came from a different benchmark or column, and 1 was unclear.
     - Records were drawn from winner-change and abstention boards, so this is not a corpus error rate.
     - The 14 errors (11 wrong split, 3 wrong value) fall into three kinds:
       - 6 are a dev or val value stored as test: DDA w/o Auto-Enc, LSK3DNet, SEN, SemiVL, T5-large and PaLM 2-L.
       - 3 are values read from a neighbouring benchmark column or task row: GPT-3 COPA, Shikra-13B and Shikra-7B.
       - 5 are records whose paper does state the split, but the record says val or "not recorded": UCF101, ICDAR2015, SUBJ, NeuralWalker and GPS.

10. **Method identity across papers.**
   - Generic method names such as "Ours", "Baseline" or "proposed framework" are not resolved across papers.
   - For example, two different papers' "Ours" can appear as the same method in a margin query.
