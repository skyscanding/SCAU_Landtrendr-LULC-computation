
// FILE:       lulc_multiyear_strict.js
// PURPOSE:    Multi-year Landsat SVM LULC pipeline with rigorous quality
//             controls ,  intended for journal/publication outputs.
// SOURCE:     Originally a domestic-journal strict pipeline script.
// PERIOD:     2000-2024
// INPUTS:     - Training points: imported via training_samples.js
//             - AOI:             projects/ee-skyscanding/assets/Final_Reprojected_zxy
// OUTPUTS:    One best-per-year GeoTIFF to Drive folder `Journal_landsat+SVM`:
//               - {year}_{best_sensor}_Classification_SVM_Best
// FEATURES VS. THE SINGLE-YEAR SCRIPTS:
//   - L8/L9 only queried for years >= 2013 (saves needless lookups)
//   - 3 GLCM texture features from NDVI (Contrast, Entropy, Homogeneity)
//   - Per-band z-score normalization (RBF-SVM is scale-sensitive)
//   - Class-balanced sampling ,  equalizes to the smallest class
//   - Clean 70/30 train/test split with fixed seed (no overlap)
//   - Best-per-year selection by (OA + Kappa) composite score
//   - Skip-export gate: discard if BOTH OA and Kappa below 0.7
// MODEL:      libsvm, RBF kernel, gamma=1, cost=100
// BANDS:      6 optical + 6 indices + 3 textures = 15 features
// SCALE:      30 m, CRS EPSG:32649



// 0) Basic setup and AOI

var cc = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy");
Map.addLayer(cc, {color: 'orange'}, 'AOI Boundary');
Map.centerObject(cc, 13);

// Study period settings
var startYear = 2000;
var endYear   = 2024;
var cloudThreshold = 20;
var exportFolder = 'Journal_landsat+SVM';

// Minimum threshold: discard if BOTH OA and Kappa below these
var OA_THRESHOLD    = 0.7;
var KAPPA_THRESHOLD = 0.7;


// Utility functions

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


// [NEW] GLCM texture features from NDVI

function addTextureFeatures(image) {
  var gray = image.select('NDVI').multiply(1000).toInt16();
  var glcm = gray.glcmTexture({size: 3});
  var contrast    = glcm.select('NDVI_contrast').rename('Texture_Contrast');
  var entropy     = glcm.select('NDVI_ent').rename('Texture_Entropy');
  var homogeneity = glcm.select('NDVI_idm').rename('Texture_Homogeneity');
  return image.addBands([contrast, entropy, homogeneity]);
}


// [NEW] Class-balanced sampling ,  equalize to smallest class

function balanceSamples(samples, classProperty, nClasses) {
  var classList = ee.List.sequence(1, nClasses);
  var classCounts = classList.map(function(c) {
    return samples.filter(ee.Filter.eq(classProperty, c)).size();
  });
  var minCount = ee.Number(classCounts.reduce(ee.Reducer.min()));
  var balanced = ee.FeatureCollection(classList.map(function(c) {
    return samples.filter(ee.Filter.eq(classProperty, c))
                  .randomColumn('balance_rand', 99)
                  .sort('balance_rand')
                  .limit(minCount);
  })).flatten();
  return balanced;
}


// Band normalization for RBF-SVM

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


// Training samples (Geometry Imports)

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
print("Class distribution:", classNames.aggregate_histogram('lc'));


// Cloud masking

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
// L8/L9 collections only queried for year >= 2013

function getLandsatSRImage(yearNum, cloudThreshold, region) {
  var nodata = -9999;
  var bandTemplate = ['Blue','Green','Red','NIR','SWIR1','SWIR2','LST'];
  var yearFilter = ee.Filter.calendarRange(yearNum, yearNum, 'year');

  var L7_SR_col = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
    .filterBounds(region)
    .filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
    .map(function(img){ return cloudMask(img, 'L7'); });

  function annualComposite(col) {
    var filtered = col.filter(yearFilter);
    var dummy = ee.Image.constant(ee.List.repeat(nodata, bandTemplate.length))
      .rename(bandTemplate).clip(region.geometry()).set('isDummy', true);
    var comp = ee.Image(ee.Algorithms.If(
      filtered.size().gt(0),
      filtered.median().clip(region.geometry()).set('isDummy', false),
      dummy
    ));
    comp = comp.focal_median(1, 'circle', 'pixels', 1);
    return comp.select(bandTemplate);
  }

  var result = ee.Dictionary({'Landsat7_SR': annualComposite(L7_SR_col)});

  if (yearNum >= 2013) {
    var L8_SR_col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(region)
      .filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
      .map(function(img){ return cloudMask(img, 'L8'); });
    var L9_SR_col = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
      .filterBounds(region)
      .filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
      .map(function(img){ return cloudMask(img, 'L9'); });
    result = result.set('Landsat89_SR', annualComposite(L8_SR_col.merge(L9_SR_col)));
  }
  return result;
}

function getLandsatTOAImage(yearNum, cloudThreshold, region) {
  var nodata = -9999;
  var bandTemplate = ['Blue','Green','Red','NIR','SWIR1','SWIR2','LST'];
  var yearFilter = ee.Filter.calendarRange(yearNum, yearNum, 'year');

  var L7_TOA_col = ee.ImageCollection('LANDSAT/LE07/C02/T1_TOA')
    .filterBounds(region)
    .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
    .map(function(img){ return cloudMaskTOA(img, 'L7'); });

  function annualComposite(col) {
    var filtered = col.filter(yearFilter);
    var dummy = ee.Image.constant(ee.List.repeat(nodata, bandTemplate.length))
      .rename(bandTemplate).clip(region.geometry()).set('isDummy', true);
    var comp = ee.Image(ee.Algorithms.If(
      filtered.size().gt(0),
      filtered.median().clip(region.geometry()).set('isDummy', false),
      dummy
    ));
    comp = comp.focal_median(1, 'circle', 'pixels', 1);
    return comp.select(bandTemplate);
  }

  var result = ee.Dictionary({'Landsat7_TOA': annualComposite(L7_TOA_col)});

  if (yearNum >= 2013) {
    var L8_TOA_col = ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA')
      .filterBounds(region)
      .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
      .map(function(img){ return cloudMaskTOA(img, 'L8'); });
    var L9_TOA_col = ee.ImageCollection('LANDSAT/LC09/C02/T1_TOA')
      .filterBounds(region)
      .filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
      .map(function(img){ return cloudMaskTOA(img, 'L9'); });
    result = result.set('Landsat89_TOA', annualComposite(L8_TOA_col.merge(L9_TOA_col)));
  }
  return result;
}


// [UPDATED] Classification bands ,  now includes 3 texture features

var classificationBands = [
  'Blue','Green','Red','NIR','SWIR1','SWIR2',
  'NDVI','EVI','NDWI','NDBI','MNDWI','FVC',
  'Texture_Contrast','Texture_Entropy','Texture_Homogeneity'
];


// SVM classification core
// Returns {image, oa, kappa} or null if dummy/insufficient samples

function trainAndClassifySVM(imageWithBands, sensorIdentifier, bandsToClassify,
                             trainingSamples, studyRegion) {
  // Server-side dummy check
  var isDummy = ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(imageWithBands.get('isDummy'), true), 1, 0
  ));

  // Normalize
  var normalizedImage = normalizeImage(imageWithBands, bandsToClassify, studyRegion);

  // Sample training regions
  var rawSamples = normalizedImage.select(bandsToClassify)
    .sampleRegions({
      collection: trainingSamples,
      properties: ['lc'],
      scale: 30,
      tileScale: 4
    });
  rawSamples = rawSamples
    .filter(ee.Filter.neq(ee.List(bandsToClassify).get(0), null))
    .filter(ee.Filter.neq('lc', null));

  // [NEW] Balance classes before splitting
  var balancedSamples = balanceSamples(rawSamples, 'lc', 5);

  // Non-overlapping 70/30 split on balanced data
  var withRandom = balancedSamples.randomColumn('random_split', 42);
  var trainingPartition = withRandom.filter(ee.Filter.lt('random_split', 0.7));
  var testingPartition  = withRandom.filter(ee.Filter.gte('random_split', 0.7));

  // SVM parameters ,  adjusted for balanced input
  var svmParameters = {
    kernelType: 'RBF',
    gamma: 1,
    cost: 100,
    svmType: 'C_SVC',
    decisionProcedure: 'Voting'
  };

  var classifier = ee.Classifier.libsvm(svmParameters).train({
    features: trainingPartition,
    classProperty: 'lc',
    inputProperties: bandsToClassify
  });

  var classifiedImage = normalizedImage.select(bandsToClassify)
    .classify(classifier)
    .clip(studyRegion.geometry());
  classifiedImage = classifiedImage.updateMask(isDummy.not());

  // Accuracy assessment
  var testResults = testingPartition.classify(classifier);
  var confusionMatrix = testResults.errorMatrix('lc', 'classification');
  var oa    = confusionMatrix.accuracy();
  var kappa = confusionMatrix.kappa();

  // Pull values client-side for the selection logic
  var oaVal, kappaVal;
  try {
    oaVal    = ee.Number(oa).getInfo();
    kappaVal = ee.Number(kappa).getInfo();
  } catch(e) {
    print('⚠ ' + sensorIdentifier + ' ,  accuracy evaluation failed: ' + e);
    return null;
  }

  print('★ ' + sensorIdentifier + ' OA: ' + oaVal.toFixed(4) +
        ', Kappa: ' + kappaVal.toFixed(4));
  print('  Confusion Matrix:', confusionMatrix);

  return {
    image: classifiedImage,
    oa: oaVal,
    kappa: kappaVal,
    name: sensorIdentifier
  };
}


// Classification entry point ,  adds indices + texture

function LandsatClassify(sensorNameKey, bandsForClassification,
                         trainingSamplesFC, aoiRegion, landsatCompositesDict) {
  var imageToClassify = ee.Image(landsatCompositesDict.get(sensorNameKey));

  // Add spectral indices
  var imageWithIndices = addAllIndices(
    imageToClassify.select(['Blue','Green','Red','NIR','SWIR1','SWIR2'])
  );
  // Add GLCM texture features
  imageWithIndices = addTextureFeatures(imageWithIndices);

  // Pass isDummy flag through
  imageWithIndices = imageWithIndices.set('isDummy', imageToClassify.get('isDummy'));

  return trainAndClassifySVM(
    imageWithIndices,
    sensorNameKey,
    bandsForClassification,
    trainingSamplesFC,
    aoiRegion
  );
}


// [NEW] Multi-year loop with BEST-PER-YEAR selection
// For each year: classify all available sensors, compare accuracy,
// export only the single best result (highest OA+Kappa composite score)

for (var y = startYear; y <= endYear; y++) {
  var yStr = y.toString();
  print("Processing year: " + yStr);

  // Generate composites (integer year passed directly)
  var sr_dict  = getLandsatSRImage(y, cloudThreshold, cc);
  var toa_dict = getLandsatTOAImage(y, cloudThreshold, cc);

  // Build sensor list for this year
  var sensorEntries = [
    {key: 'Landsat7_SR',  dict: sr_dict},
    {key: 'Landsat7_TOA', dict: toa_dict}
  ];
  if (y >= 2013) {
    sensorEntries.push({key: 'Landsat89_SR',  dict: sr_dict});
    sensorEntries.push({key: 'Landsat89_TOA', dict: toa_dict});
  }

  // Classify all sensors and collect results
  var results = [];
  sensorEntries.forEach(function(entry) {
    var result = LandsatClassify(
      entry.key, classificationBands, classNames, cc, entry.dict
    );
    if (result !== null) {
      results.push(result);
    }
  });

  // Select the best result by composite score (OA + Kappa)
  if (results.length === 0) {
    print('✘ Year ' + yStr + ': ALL sensors failed or returned null. No export.');
    continue;
  }

  // Sort by combined score descending, pick the top one
  results.sort(function(a, b) {
    return (b.oa + b.kappa) - (a.oa + a.kappa);
  });

  var best = results[0];
  var bestScore = best.oa + best.kappa;

  // Apply minimum threshold on the best result
  if (best.oa < OA_THRESHOLD && best.kappa < KAPPA_THRESHOLD) {
    print('✘ Year ' + yStr + ': Best was ' + best.name +
          ' (OA=' + best.oa.toFixed(4) + ', Kappa=' + best.kappa.toFixed(4) +
          ') but both below threshold. No export.');
    continue;
  }

  // Log all candidates for this year
  print('── Year ' + yStr + ' candidates ──');
  results.forEach(function(r) {
    var tag = (r.name === best.name) ? ' ◀ BEST' : '';
    print('   ' + r.name + ': OA=' + r.oa.toFixed(4) +
          ', Kappa=' + r.kappa.toFixed(4) + tag);
  });

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