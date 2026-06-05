"""SVM classification core — z-score normalization, class balancing,
training, and accuracy assessment.

Mirrors the JS `normalizeImage`, `balanceSamples`, and
`trainAndClassifySVM` functions from the strict pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass
import ee


@dataclass
class ClassificationResult:
    image: ee.Image
    oa: float
    kappa: float
    name: str

    @property
    def score(self) -> float:
        return self.oa + self.kappa


def normalize_image(
    image: ee.Image,
    bands: list[str],
    region: ee.FeatureCollection,
    scale: int = 30,
) -> ee.Image:
    """Per-band z-score normalization computed over the AOI.

    RBF-SVM is scale-sensitive, so this is important when feature ranges
    differ by orders of magnitude (e.g., raw reflectance vs. GLCM contrast).
    """
    bands_ee = ee.List(bands)
    mean_dict = image.select(bands_ee).reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=region.geometry(),
        scale=scale,
        maxPixels=int(1e9),
        tileScale=4,
    )
    std_dict = image.select(bands_ee).reduceRegion(
        reducer=ee.Reducer.stdDev(),
        geometry=region.geometry(),
        scale=scale,
        maxPixels=int(1e9),
        tileScale=4,
    )

    def _normalize_band(band):
        band = ee.String(band)
        mean = ee.Number(mean_dict.get(band))
        std = ee.Number(std_dict.get(band))
        # Guard against zero variance bands
        std = ee.Number(ee.Algorithms.If(std.eq(0), 1, std))
        return image.select(band).subtract(mean).divide(std)

    band_images = bands_ee.map(_normalize_band)
    return ee.ImageCollection(band_images).toBands().rename(bands_ee)


def balance_samples(
    samples: ee.FeatureCollection,
    class_property: str = "lc",
    n_classes: int = 5,
    seed: int = 99,
) -> ee.FeatureCollection:
    """Down-sample each class to the smallest class size to balance the
    training set. Returns a FeatureCollection.
    """
    class_list = ee.List.sequence(1, n_classes)
    class_counts = class_list.map(
        lambda c: samples.filter(ee.Filter.eq(class_property, c)).size()
    )
    min_count = ee.Number(class_counts.reduce(ee.Reducer.min()))

    def _take_min(c):
        return (
            samples.filter(ee.Filter.eq(class_property, c))
            .randomColumn("balance_rand", seed)
            .sort("balance_rand")
            .limit(min_count)
        )

    return ee.FeatureCollection(class_list.map(_take_min)).flatten()


def train_and_classify_svm(
    image_with_bands: ee.Image,
    sensor_id: str,
    bands_to_classify: list[str],
    training_samples: ee.FeatureCollection,
    study_region: ee.FeatureCollection,
    *,
    use_balancing: bool = True,
    n_classes: int = 5,
    gamma: float = 1.0,
    cost: float = 100.0,
    train_fraction: float = 0.7,
    seed: int = 42,
    scale: int = 30,
) -> ClassificationResult | None:
    """Normalize → sample → balance (optional) → split → train libsvm → assess.

    Returns a `ClassificationResult`, or `None` if the input is a dummy image,
    fewer than 10 samples survived filtering, or accuracy could not be computed.
    """
    # Server-side dummy check
    is_dummy_value = image_with_bands.get("isDummy")
    is_dummy = ee.Number(
        ee.Algorithms.If(ee.Algorithms.IsEqual(is_dummy_value, True), 1, 0)
    )

    # Normalize feature bands
    normalized = normalize_image(image_with_bands, bands_to_classify, study_region, scale)

    # Sample at training points
    samples = normalized.select(bands_to_classify).sampleRegions(
        collection=training_samples,
        properties=["lc"],
        scale=scale,
        tileScale=4,
    )
    samples = samples.filter(
        ee.Filter.neq(ee.List(bands_to_classify).get(0), None)
    ).filter(ee.Filter.neq("lc", None))

    # Optional balancing
    if use_balancing:
        samples = balance_samples(samples, "lc", n_classes)

    # Check sample count (forces a server roundtrip — cheap enough here)
    try:
        n_samples = samples.size().getInfo()
    except Exception as e:
        print(f"⚠ {sensor_id} — sample count failed: {e}")
        return None
    if n_samples < 10:
        print(f"⚠ {sensor_id} — only {n_samples} samples after filtering, skipping.")
        return None

    # Non-overlapping train/test split with fixed seed
    with_rand = samples.randomColumn("random_split", seed)
    training = with_rand.filter(ee.Filter.lt("random_split", train_fraction))
    testing = with_rand.filter(ee.Filter.gte("random_split", train_fraction))

    # Train
    try:
        classifier = ee.Classifier.libsvm(
            kernelType="RBF",
            gamma=gamma,
            cost=cost,
            svmType="C_SVC",
            decisionProcedure="Voting",
        ).train(
            features=training,
            classProperty="lc",
            inputProperties=bands_to_classify,
        )
    except Exception as e:
        print(f"⚠ {sensor_id} — classifier training failed: {e}")
        return None

    classified = (
        normalized.select(bands_to_classify)
        .classify(classifier)
        .clip(study_region.geometry())
        .updateMask(is_dummy.Not())
    )

    # Accuracy assessment
    try:
        test_results = testing.classify(classifier)
        cm = test_results.errorMatrix("lc", "classification")
        oa = ee.Number(cm.accuracy()).getInfo()
        kappa = ee.Number(cm.kappa()).getInfo()
    except Exception as e:
        print(f"⚠ {sensor_id} — accuracy evaluation failed: {e}")
        return None

    if oa is None or kappa is None:
        print(f"⚠ {sensor_id} — OA/Kappa came back null.")
        return None

    print(f"★ {sensor_id}: OA={oa:.4f}, Kappa={kappa:.4f}")
    return ClassificationResult(image=classified, oa=oa, kappa=kappa, name=sensor_id)
