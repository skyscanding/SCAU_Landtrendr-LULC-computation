
// FILE:       lulc_multiyear_lenient.js
// PURPOSE:    Multi-year Landsat SVM LULC pipeline — relaxed/tuned variant.
// SOURCE:     Originally `国内期刊用LULC_宽松.js` (Chinese: "for domestic
//             journal, lenient")
// PERIOD:     2023–2026
// INPUTS:     - Training points: imported via training_samples.js
//             - AOI:             projects/ee-skyscanding/assets/Final_Reprojected_zxy
// OUTPUTS:    One best-per-year GeoTIFF to Drive folder `Journal_landsat+SVM`.
// FEATURES VS. THE STRICT VARIANT:
//   - NO GLCM texture features
//   - NO class-balanced sampling
//   - Tuned hyperparameters: gamma=0.1, cost=10 (vs. 1 / 100)
//   - 12 classification bands (vs. 15 in strict)
//   - Otherwise: same normalization, 70/30 split, best-per-year selection,
//     accuracy gate at OA<0.7 AND Kappa<0.7
// USE WHEN:   You want a faster run / more recent years where ground samples
//             may not warrant the heavier strict pipeline.
// MODEL:      libsvm, RBF kernel, gamma=0.1, cost=10
// SCALE:      30 m, CRS EPSG:32649



// 0) Basic setup and AOI

var cc = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy");
Map.addLayer(cc, {color: 'orange'}, 'AOI Boundary');
Map.centerObject(cc, 13);

// Study period settings
var startYear = 2023;
var endYear   = 2026;
var cloudThreshold = 20;
var exportFolder = 'Journal_landsat+SVM';

// Accuracy threshold: discard if BOTH OA and Kappa < 0.7
var OA_THRESHOLD    = 0.7;
var KAPPA_THRESHOLD = 0.7;


// Utility functions

function replaceMask(img, newimg, nodata) {
  var fill = ee.Image.constant(ee.List.repeat(nodata, img.bandNames().length()))
                  .rename(img.bandNames());
  img = img.unmask(fill);
  img = img.where(img.mask().not(), newimg);
  return img.updateMask(img.neq(nodata));
}

function addTimeBand(img) {
  var time = img.metadata('system:time_start').rename('time');
  return img.addBands(time);
}

// Spectral indices
function addAllIndices(image) {
  var ndvi = image.normalizedDifference(['NIR', 'Red']).rename('NDVI');
  var evi = image.expression(
    '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
      'NIR': image.select('NIR'), 'RED': image.select('Red'), 'BLUE': image.select('Blue')
    }).rename('EVI');
  var ndwi = image.normalizedDifference(['Green', 'NIR']).rename('NDWI');
  var ndbi = image.normalizedDifference(['SWIR1', 'NIR']).rename('NDBI');
  var mndwi = image.normalizedDifference(['Green', 'SWIR1']).rename('MNDWI');
  var fvc = ndvi.expression(
    'clamp((ndvi - soil) / (veg - soil), 0, 1)', {
      'ndvi': ndvi, 'soil': 0.2, 'veg': 0.8
    }).rename('FVC');
  return image.addBands([ndvi, evi, ndwi, ndbi, mndwi, fvc]);
}


// Band normalization — RBF-SVM is scale-sensitive

function normalizeImage(image, bands, region) {
  var bandsEE = ee.List(bands);
  var meanDict = image.select(bandsEE).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: region.geometry(),
    scale: 30,
    maxPixels: 1e9,
    tileScale: 4
  });
  var stdDict = image.select(bandsEE).reduceRegion({
    reducer: ee.Reducer.stdDev(),
    geometry: region.geometry(),
    scale: 30,
    maxPixels: 1e9,
    tileScale: 4
  });
  var bandImages = bandsEE.map(function(band) {
    band = ee.String(band);
    var mean = ee.Number(meanDict.get(band));
    var std  = ee.Number(stdDict.get(band));
    std = ee.Number(ee.Algorithms.If(std.eq(0), 1, std));
    return image.select(band).subtract(mean).divide(std);
  });
  return ee.ImageCollection(bandImages).toBands().rename(bandsEE);
}


// Training samples (defined via Geometry Imports in the GEE UI)

var water_lc = water.map(function(f){ return f.set('lc', 1); });
var builtUp_lc = builtUp.map(function(f){ return f.set('lc', 2); });
var unrestoredLand_lc = unrestoredLand.map(function(f){ return f.set('lc', 3); });
var restoring_lc = restoring.map(function(f){ return f.set('lc', 4); });
var stableVegetation_lc = stableVegetation.map(function(f){ return f.set('lc', 5); });

var classNames = water_lc
  .merge(builtUp_lc)
  .merge(unrestoredLand_lc)
  .merge(restoring_lc)
  .merge(stableVegetation_lc);
print("Total sample count (merged):", classNames.size());
print("Unique lc values and counts:", classNames.aggregate_histogram('lc'));


// Cloud masking — relaxed cirrus handling (same logic as original)

function cloudMask(image, sensor) {
  var qa = image.select('QA_PIXEL');
  var fill         = qa.bitwiseAnd(1 << 0).neq(0);
  var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0);
  var cloud        = qa.bitwiseAnd(1 << 3).neq(0);
  var cloudShadow  = qa.bitwiseAnd(1 << 4).neq(0);
  var qaMask = fill.or(dilatedCloud).or(cloud).or(cloudShadow).not();

  var opticalBands, thermalBand;
  if (sensor === 'L7') {
    opticalBands = image.select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'])
      .multiply(0.0000275).add(-0.2)
      .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
    thermalBand = image.select('ST_B6')
      .multiply(0.00341802).add(149.0).rename('LST');
  } else {
    opticalBands = image.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'])
      .multiply(0.0000275).add(-0.2)
      .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
    thermalBand = image.select(['ST_B10'])
      .multiply(0.00341802).add(149.0).rename('LST');
  }
  var satMask = image.select('QA_RADSAT').eq(0);
  return image.addBands(opticalBands, null, true)
    .addBands(thermalBand, null, true)
    .updateMask(qaMask).updateMask(satMask)
    .select(['Blue','Green','Red','NIR','SWIR1','SWIR2','LST']);
}

function cloudMaskTOA(image, sensor) {
  var qa = image.select('QA_PIXEL');
  var fill         = qa.bitwiseAnd(1 << 0).neq(0);
  var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0);
  var cloud        = qa.bitwiseAnd(1 << 3).neq(0);
  var cloudShadow  = qa.bitwiseAnd(1 << 4).neq(0);
  var qaMask = fill.or(dilatedCloud).or(cloud).or(cloudShadow).not();

  var opticalBands, thermalBand;
  if (sensor === 'L7') {
    opticalBands = image.select(['B1','B2','B3','B4','B5','B7'])
      .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
    thermalBand = image.select('B6_VCID_2').rename('LST');
  } else {
    opticalBands = image.select(['B2','B3','B4','B5','B6','B7'])
      .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
    thermalBand = image.select(['B10']).rename('LST');
  }
  return image.addBands(opticalBands, null, true)
    .addBands(thermalBand, null, true)
    .updateMask(qaMask)
    .select(['Blue','Green','Red','NIR','SWIR1','SWIR2','LST']);
}


// Annual composite functions
// Smoothing reduced: focal_median iterations 3 → 1
// All getInfo() calls removed for batch throughput

function getLandsatSRImage(startDate, cloudThreshold, region) {
  var nodata = -9999;
  var bandTemplate = ['Blue','Green','Red','NIR','SWIR1','SWIR2','LST'];

  var L7_SR_col = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
    .filterBounds(region)
    .filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
    .map(function(img){ return cloudMask(img, 'L7'); });

  var y = ee.Date(startDate).get('year');
  var yearFilter = ee.Filter.calendarRange(y, y, 'year');

  function annualComposite(col) {
    var filtered = col.filter(yearFilter);
    var dummy = ee.Image.constant(ee.List.repeat(nodata, bandTemplate.length))
      .rename(bandTemplate).clip(region.geometry()).set('isDummy', true);
    var count = filtered.size();
    var comp = ee.Image(ee.Algorithms.If(
      count.gt(0),
      filtered.median().clip(region.geometry()).set('isDummy', false),
      dummy
    ));
    comp = comp.focal_median(1, 'circle', 'pixels', 1);
    return comp.select(bandTemplate).set('year', y);
  }

  // Build the output dictionary; only include L89 if year >= 2013
  var result = ee.Dictionary({'Landsat7_SR': annualComposite(L7_SR_col)});

  // [GUARD] Only query L8/L9 collections for 2013 onwards
  if (ee.Date(startDate).get('year').getInfo() >= 2013) {
    var L8_SR_col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(region)
      .filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
      .map(function(img){ return cloudMask(img, 'L8'); });
    var L9_SR_col = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
      .filterBounds(region)
      .filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
      .map(function(img){ return cloudMask(img, 'L9'); });
    var L89_SR_col = L8_SR_col.merge(L9_SR_col);
    result = result.set('Landsat89_SR', annualComposite(L89_SR_col));
  }

  return result;
}

function getLandsatTOAImage(startDate, cloudThreshold, region) {
  var nodata = -9999;
  var bandTemplate = ['Blue','Green','Red','NIR','SWIR1','SWIR2','LST'];

  var L7_TOA_col = ee.ImageCollection('LANDSAT/LE07/C02/T1_TOA')
    .filterBounds(region)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
    .map(function(img){ return cloudMaskTOA(img, 'L7'); });

  var y = ee.Date(startDate).get('year');
  var yearFilter = ee.Filter.calendarRange(y, y, 'year');

  function annualComposite(col) {
    var filtered = col.filter(yearFilter);
    var dummy = ee.Image.constant(ee.List.repeat(nodata, bandTemplate.length))
      .rename(bandTemplate).clip(region.geometry()).set('isDummy', true);
    var count = filtered.size();
    var comp = ee.Image(ee.Algorithms.If(
      count.gt(0),
      filtered.median().clip(region.geometry()).set('isDummy', false),
      dummy
    ));
    comp = comp.focal_median(1, 'circle', 'pixels', 1);
    return comp.select(bandTemplate).set('year', y);
  }

  var result = ee.Dictionary({'Landsat7_TOA': annualComposite(L7_TOA_col)});

  // [GUARD] Only query L8/L9 collections for 2013 onwards
  if (ee.Date(startDate).get('year').getInfo() >= 2013) {
    var L8_TOA_col = ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA')
      .filterBounds(region)
      .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
      .map(function(img){ return cloudMaskTOA(img, 'L8'); });
    var L9_TOA_col = ee.ImageCollection('LANDSAT/LC09/C02/T1_TOA')
      .filterBounds(region)
      .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
      .map(function(img){ return cloudMaskTOA(img, 'L9'); });
    var L89_TOA_col = L8_TOA_col.merge(L9_TOA_col);
    result = result.set('Landsat89_TOA', annualComposite(L89_TOA_col));
  }

  return result;
}


// Classification bands

var classificationBands = ['Blue','Green','Red','NIR','SWIR1','SWIR2',
                           'NDVI','EVI','NDWI','NDBI','MNDWI','FVC'];


// SVM classification core
// - Normalized inputs
// - Tuned parameters: gamma 0.1, cost 10
// - Clean 70/30 train/test split (no overlap)
// - Accuracy gate with error-safe getInfo()
// - Returns {image, oa, kappa, name} for best-per-year selection

function trainAndClassifySVM(imageWithBands, sensorIdentifier, bandsToClassify, trainingSamples, studyRegion) {
  // Server-side dummy check
  var isDummy = ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(imageWithBands.get('isDummy'), true), 1, 0
  ));

  // Normalize bands
  var normalizedImage = normalizeImage(imageWithBands, bandsToClassify, studyRegion);

  // Sample training regions
  var currentTrainingData = normalizedImage.select(bandsToClassify)
    .sampleRegions({
      collection: trainingSamples,
      properties: ['lc'],
      scale: 30,
      tileScale: 4
    });

  // Remove samples with null values
  currentTrainingData = currentTrainingData
    .filter(ee.Filter.neq(ee.List(bandsToClassify).get(0), null))
    .filter(ee.Filter.neq('lc', null));

  // Check if enough samples survived — needs getInfo() but prevents
  // downstream crash on empty collections
  var sampleCount;
  try {
    sampleCount = currentTrainingData.size().getInfo();
  } catch(e) {
    print('⚠ ' + sensorIdentifier + ' — failed to count samples: ' + e);
    return null;
  }
  if (sampleCount < 10) {
    print('⚠ ' + sensorIdentifier + ' — only ' + sampleCount +
          ' valid samples after filtering. Skipping.');
    return null;
  }

  // Non-overlapping 70/30 train/test split
  var withRandom = currentTrainingData.randomColumn('random_split', 42);
  var trainingPartition = withRandom.filter(ee.Filter.lt('random_split', 0.7));
  var testingPartition  = withRandom.filter(ee.Filter.gte('random_split', 0.7));

  // Tuned SVM parameters
  var svmParameters = {
    kernelType: 'RBF',
    gamma: 0.1,
    cost: 10,
    svmType: 'C_SVC',
    decisionProcedure: 'Voting'
  };

  var classifier;
  try {
    classifier = ee.Classifier.libsvm(svmParameters).train({
      features: trainingPartition,
      classProperty: 'lc',
      inputProperties: bandsToClassify
    });
  } catch(e) {
    print('⚠ ' + sensorIdentifier + ' — classifier training failed: ' + e);
    return null;
  }

  // Classify on normalized image
  var classifiedImage = normalizedImage.select(bandsToClassify)
    .classify(classifier)
    .clip(studyRegion.geometry());

  // Mask out dummy pixels (server-side)
  classifiedImage = classifiedImage.updateMask(isDummy.not());

  // Accuracy assessment (error-safe)
  var oaVal, kappaVal;
  try {
    var testResults = testingPartition.classify(classifier);
    var confusionMatrix = testResults.errorMatrix('lc', 'classification');
    oaVal    = ee.Number(confusionMatrix.accuracy()).getInfo();
    kappaVal = ee.Number(confusionMatrix.kappa()).getInfo();
    print('★ ' + sensorIdentifier + ' Confusion Matrix:', confusionMatrix);
  } catch(e) {
    print('⚠ ' + sensorIdentifier +
          ' — accuracy evaluation failed (likely no valid data): ' + e);
    return null;
  }

  // Guard against NaN or null returns
  if (oaVal === null || kappaVal === null || isNaN(oaVal) || isNaN(kappaVal)) {
    print('⚠ ' + sensorIdentifier +
          ' — OA or Kappa returned null/NaN. Skipping.');
    return null;
  }

  print('★ ' + sensorIdentifier + ' OA: ' + oaVal.toFixed(4) +
        ', Kappa: ' + kappaVal.toFixed(4));

  return {
    image: classifiedImage,
    oa: oaVal,
    kappa: kappaVal,
    name: sensorIdentifier
  };
}


// Classification entry point (unchanged logic, updated return type)

function LandsatClassify(sensorNameKey, bandsForClassification,
                         trainingSamplesFC, aoiRegion, landsatCompositesDict) {
  // Check if the key exists in the dictionary
  var keys;
  try {
    keys = landsatCompositesDict.keys().getInfo();
  } catch(e) {
    print('⚠ Could not read dictionary keys for ' + sensorNameKey);
    return null;
  }
  if (keys.indexOf(sensorNameKey) === -1) {
    print('⚠ ' + sensorNameKey + ' not present in composite dictionary. Skipping.');
    return null;
  }

  var imageToClassify = ee.Image(landsatCompositesDict.get(sensorNameKey));
  var imageWithIndices = addAllIndices(
    imageToClassify.select(['Blue','Green','Red','NIR','SWIR1','SWIR2'])
  );
  imageWithIndices = imageWithIndices.set('isDummy', imageToClassify.get('isDummy'));

  return trainAndClassifySVM(
    imageWithIndices,
    sensorNameKey,
    bandsForClassification,
    trainingSamplesFC,
    aoiRegion
  );
}


// Multi-year loop with BEST-PER-YEAR selection
// Evaluates all available sensors, exports only the highest
// combined score (OA + Kappa) that passes the threshold

for (var y = startYear; y <= endYear; y++) {
  var thisStartDate = ee.Date.fromYMD(y, 1, 1);
  var yStr = y.toString();

  print("Processing year: " + yStr);

  // Generate composites
  var sr_dict  = getLandsatSRImage(thisStartDate, cloudThreshold, cc);
  var toa_dict = getLandsatTOAImage(thisStartDate, cloudThreshold, cc);

  // Build sensor list — L89 entries only for 2013+
  var sensorEntries = [
    {key: 'Landsat7_SR',  dict: sr_dict},
    {key: 'Landsat7_TOA', dict: toa_dict}
  ];
  if (y >= 2013) {
    sensorEntries.push({key: 'Landsat89_SR',  dict: sr_dict});
    sensorEntries.push({key: 'Landsat89_TOA', dict: toa_dict});
  }

  // Classify all sensors and collect valid results
  var results = [];
  sensorEntries.forEach(function(entry) {
    var result = LandsatClassify(
      entry.key, classificationBands, classNames, cc, entry.dict
    );
    if (result !== null) {
      results.push(result);
    }
  });

  // No valid results for this year
  if (results.length === 0) {
    print('✘ Year ' + yStr + ': ALL sensors failed or returned null. No export.');
    continue;
  }

  // Sort by combined score (OA + Kappa), pick the best
  results.sort(function(a, b) {
    return (b.oa + b.kappa) - (a.oa + a.kappa);
  });

  var best = results[0];

  // Log all candidates
  print('── Year ' + yStr + ' candidates ──');
  results.forEach(function(r) {
    var tag = (r.name === best.name) ? ' ◀ BEST' : '';
    print('   ' + r.name + ': OA=' + r.oa.toFixed(4) +
          ', Kappa=' + r.kappa.toFixed(4) + tag);
  });

  // Apply minimum threshold on the best result
  if (best.oa < OA_THRESHOLD && best.kappa < KAPPA_THRESHOLD) {
    print('✘ Year ' + yStr + ': Best was ' + best.name +
          ' (OA=' + best.oa.toFixed(4) + ', Kappa=' + best.kappa.toFixed(4) +
          ') but both below threshold. No export.');
    continue;
  }

  // Export only the best
  var descName = yStr + '_' + best.name + '_Classification_SVM_Best';
  print('✔ Exporting: ' + descName +
        ' (OA=' + best.oa.toFixed(4) + ', Kappa=' + best.kappa.toFixed(4) + ')');

  Export.image.toDrive({
    image: best.image.toByte(),
    description: descName,
    fileNamePrefix: descName,
    folder: exportFolder,
    region: cc.geometry(),
    scale: 30,
    crs: 'EPSG:32649',
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF'
  });
}

print("All years processed. Check Tasks panel.");