# Code assessment — original GEE JavaScript

This is a focused review of the five `.js` files in `gee_scripts/`. The
intent is to inform future iterations — none of the issues below are
blocking; the scripts ran and produced your journal outputs.

## File-by-file summary

### `training_samples.js` (was `ROI_POIs.js`)
Pure Geometry Imports — five FeatureCollections plus the AOI. Nothing to
critique. One small thing: the `lc` attribute is left empty in the
features themselves; the consumer scripts assign codes via `.map(f =>
f.set('lc', N))`. That works but creates the implicit contract that the
class code lives in the *script* rather than the data. If you ever
upload these as GEE assets, persist `lc` at upload time and drop the
`.map` step.

### `landsat_svm.js` (was `Landsat_SVM1.js`)
Single-year (2014) Landsat 7/8/9 SR+TOA. The earliest of the scripts and
the most rough around the edges.

| Concern | Detail |
|---|---|
| Heavy `getInfo()` use | At least 8 client-side roundtrips inside `trainAndClassifySVM`, several inside conditionals. Fine for one year; would be a problem if you tried to wrap this in a year loop. |
| Inconsistent indentation | Lines 78–96 sit at column 0 while the surrounding block is indented. Likely a copy-paste artifact. |
| Train/test sets can overlap | `trainingFraction = 0.8`, `testingFraction = 0.4` with different seeds — by design, but worth noting that ~32% of the training set also appears in testing. Optimistic accuracy estimates. |
| Mixed languages in console output | Some Chinese, some English — fine when you're the only reader. |
| Confusion-matrix labels | OK, but the `bandsToClassify_ee.get(0)` filter only checks the first band for null; if subsequent bands are masked the sample still slips through. The Python `lib/svm_classify.py` keeps this same logic to match. |

The cloud mask and composite logic are sound. The `replaceMask` /
`addTimeBand` helpers at the top are defined but never used.

### `sentinel2_svm.js` (was `Sentinel_SVM.js`)
Single-year (2018) Sentinel-2 with Cloud Score+. Nicely uses
`linkCollection` to join the cloud-score band, which is the canonical
modern approach.

| Concern | Detail |
|---|---|
| ~70-line commented-out GapFill block | Lines 143–197. The intent (linear-fit fill from a temporal neighborhood) is interesting but it's dead code now. If you don't plan to revive it, delete it — it adds reading load. |
| `isDummyCheck` logic is fragile | Mixes a `reduceRegion(...).values().get(0)` (which may return null) with an unrelated boolean. Works for the current AOI but is hard to reason about. |
| No texture or normalization | The strict pipeline added both. Worth back-porting if you want S2 outputs comparable to the journal Landsat outputs. |

### `lulc_multiyear_strict.js`
The "production" script. Clear pivot from prototype to publication-grade:

- Multi-year loop with a clean accuracy gate.
- GLCM texture features computed from NDVI.
- `balanceSamples` — equalize each class to the smallest, which is the
  right move when one class (e.g. water) is much smaller than the
  others.
- Z-score normalization — RBF-SVM cares about scale.
- 70/30 train/test split with no overlap and a fixed seed.
- Best-per-year selection on `OA + Kappa`.
- `OA_THRESHOLD` / `KAPPA_THRESHOLD` discard rule.

Things I'd still flag:

- L7 alone for early years (pre-2013) has known scan-line corruption
  (SLC-off after 2003). The compositing tolerates it but accuracy in
  2003–2012 will inherit those gaps. Consider also pulling Landsat 5 TM
  (`LANDSAT/LT05/C02/T1_L2`) for 2000–2011 to fill in.
- The `balanceSamples` down-samples to the *smallest* class. If "water"
  has 50 points and the others have 500 each, you're discarding 90% of
  your training data globally. Consider up-weighting the small classes
  in libsvm via `cost` instead, or oversampling with replacement.
- Fixed seed (`42`) for train/test split — fine, but a small
  cross-validation loop would give honest variance.
- Per-year normalization stats are computed independently. That means
  band values aren't comparable across years in the *normalized* image.
  For the classifier that's not a problem (each year trains on its own
  features), but if you wanted to inspect a normalized stack across
  years you'd see drift.

### `lulc_multiyear_lenient.js`
Mostly the strict pipeline with three changes: no texture, no class
balancing, tuned hyperparameters (`gamma=0.1`, `cost=10`). The relaxed
gamma is more defensible than the strict version's `gamma=1` for
normalized inputs — `1/n_features` (~0.067 for 15 features) is a common
sklearn default and `0.1` is in the same neighborhood.

> Suggestion: collapse the two scripts into one with a `--mode strict |
> lenient` switch (or expose `use_texture`, `use_balancing`, `gamma`,
> `cost` as parameters). The Python version `02_landsat_svm_multiyear.py`
> already does this; you can mirror the change back to JS by extracting
> a config block.

---

## Cross-cutting suggestions

1. **One source of truth for shared helpers.** `addAllIndices`, the
   cloud masks, and `classNames` merging are defined four times across
   the JS files. GEE supports user-published modules via `require()` —
   you could publish your helpers as a GEE repo and `require` them.
   The Python `lib/` does this already.

2. **Hardcoded asset path.** `projects/ee-skyscanding/assets/Final_Reprojected_zxy`
   appears in every script. Lift it to a top-of-file constant so future
   AOI changes are one-line edits.

3. **Drive folder naming.** Mixed Chinese/English with spaces and `+`
   characters — Drive tolerates them, downstream tooling may not. Use
   ASCII-only, hyphen-separated names like `landsat-svm-strict`.

4. **No version control on samples.** The training points live inside
   the JS — if you edit them in the Code Editor, you lose the
   diff history. Either export them as a GEE asset (immutable) or as
   GeoJSON in `data/` (versioned).

5. **Magic numbers.** `gamma=1`, `cost=100`, `gamma=0.1`, `cost=10`,
   thresholds at `0.7` — these are fine choices but uncommented. Even
   a single-line "// tuned on 2020 L8 to OA=0.84" makes future-you
   grateful.

## Did anything actually break?

Nothing I can flag without running the scripts. The error handling is
defensive enough that bad inputs degrade to a console warning rather
than a hard crash. The two single-year scripts contain some debug
`print()` calls that could be cleaned up but don't change behavior.
