// FILE:       landtrendr_disturbance.js
// PURPOSE:    LandTrendr temporal segmentation with SVM-based disturbance
//             duration prediction for the Dabaoshan mine area.
// NOTE:       Tested and can apply SVM training to check sample accuracy,
//             but not systematically reviewed, still needs periodic adjustment.
// DEPENDENCY: users/emaprlab/public:Modules/LandTrendr.js
// INPUTS:     AOI: projects/ee-skyscanding/assets/Final_Reprojected_zxy
//             Training points: imported via training_samples.js
// OUTPUTS:    LandTrendr rasters (YOD/MAG/DUR/MPY) + SVM-predicted duration
//             map to Drive folder `LandTrendr_export`.
// PERIOD:     2013-2025 (disturbance window)
// SCALE:      30 m, CRS EPSG:32649

// Study area
var roi = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy");
Map.centerObject(roi, 13);
Map.addLayer(roi, {color: 'orange'}, 'Study Area');

// Analysis year range
var startYear = 2013;
var endYear   = 2025;

var startFilter = startYear + '-01-01';
var endFilter   = endYear   + '-01-01';  // exclusive end date

// LandTrendr parameters
var runParams = {
  maxSegments:            6,
  spikeThreshold:         0.9,
  vertexCountOvershoot:   3,
  preventOneYearRecovery: true,
  recoveryThreshold:      0.25,
  pvalThreshold:          0.05,
  bestModelProportion:    0.75,
  minObservationsNeeded:  6
};

// Change detection parameters
var changeParams = {
  delta:  'loss',
  sort:   'greatest',
  year:   {checked: true, start: startYear, end: endYear},
  mag:    {checked: true, value: 200,  operator: '>'},
  dur:    {checked: true, value: 5,    operator: '<'},
  preval: {checked: true, value: 300,  operator: '>'},
  mmu:    {checked: true, value: 11},
  index:  'NBR'
};

// Load the emaprlab LandTrendr module
var ltgee = require('users/emaprlab/public:Modules/LandTrendr.js');

// Class definitions
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

// Band rename and cloud mask functions

// Landsat 8 and 9 band rename
function bandRenameL89(image) {
  return image.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'])
              .rename(['blue', 'green', 'red', 'nir', 'swir1', 'swir2']);
}

// Landsat 5 and 7 band rename
function bandRenameL57(image) {
  return image.select(['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'])
              .rename(['blue', 'green', 'red', 'nir', 'swir1', 'swir2']);
}

// Apply Landsat SR scaling factors
function applyScaleFactors(image) {
  return image.addBands(
    image.select('SR_B.*').multiply(0.0000275).add(-0.2),
    null,
    true
  );
}

// Cloud mask for Landsat 5 and 7
function cloudMask57(image) {
  image = ee.Image(image);

  // QA mask: first 5 bits must be 0
  var qaMask = ee.Image(image).select('QA_PIXEL')
    .bitwiseAnd(parseInt('11111', 2)).eq(0);

  // Radiometric saturation mask
  var satMask = ee.Image(image).select('QA_RADSAT').eq(0);

  // Optical bands: scale + rename
  var optical = ee.Image(image).select([
      'SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'
    ])
    .multiply(0.0000275).add(-0.2)
    .rename(['blue','green','red','nir','swir1','swir2']);

  // Thermal band: scale + rename
  var thermal = ee.Image(image).select('ST_B6')
    .multiply(0.00341802).add(149.0)
    .rename('thermal');

  var combined = ee.Image(image)
    .addBands(optical)
    .addBands(thermal)
    .updateMask(qaMask)
    .updateMask(satMask)
    .copyProperties(image, ['system:time_start']);

  return ee.Image(combined).select([
    'blue','green','red','nir','swir1','swir2','thermal'
  ]);
}

// Cloud mask for Landsat 8 (and 9)
function cloudMask8(image) {
  image = ee.Image(image);

  // QA mask
  var qaMask = image.select('QA_PIXEL')
    .bitwiseAnd(parseInt('11111', 2)).eq(0);
  // Radiometric saturation mask
  var satMask = image.select('QA_RADSAT').eq(0);

  // Optical bands: scale + rename
  var optical = image.select([
      'SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7'
    ])
    .multiply(0.0000275).add(-0.2)
    .rename(['blue','green','red','nir','swir1','swir2']);

  // Thermal band: scale + rename
  var thermal = image.select('ST_B10')
    .multiply(0.00341802).add(149.0)
    .rename('thermal');

  // Combine bands
  var withBands = ee.Image(image)
    .addBands(optical)
    .addBands(thermal);

  // Apply masks
  var masked = withBands
    .updateMask(qaMask)
    .updateMask(satMask);

  // Copy properties
  var copied = masked.copyProperties(image, ['system:time_start']);

  var result = ee.Image(copied).select([
    'blue','green','red','nir','swir1','swir2','thermal'
  ]);
  return result;
}

// Apply cloudMask57 to L5/L7 SR for the analysis window
var collection57 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
    .filterDate(startFilter, endFilter)
    .map(cloudMask57);

// Apply cloudMask8 to L8 SR
var collection8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterDate(startFilter, endFilter)
    .map(cloudMask8);

var composite8 = collection8.median();

// Preview composite (RGB = red, green, blue)
Map.setCenter(-4.52, 40.29, 7);
Map.addLayer(
  composite8,
  {bands: ['red','green','blue'], min: 0, max: 0.3},
  'L8 SR Composite'
);

// Return last day of month (ignores leap year for Feb)
function getMonthEndDay(m) {
  if (m === 2) {
    return 28;
  } else if ([4, 6, 9, 11].indexOf(m) !== -1) {
    return 30;
  } else {
    return 31;
  }
}

// Full-year date range
var startDate = '01-01';
var endDate   = '12-31';

// Run LandTrendr via the emaprlab module
var lt = ltgee.runLT(
  startYear,
  endYear,
  startDate,
  endDate,
  roi,
  'NBR',
  [],            // FTV list (usually empty)
  runParams,
  ['cloud','shadow','snow','water']  // mask types
);

// Get change map
var changeImg = ltgee.getChangeMap(lt, changeParams).clip(roi);

// Recover MAG to NBR units (LandTrendr outputs MAG x 1000 as integer)
var magNBR = changeImg.select('mag').multiply(0.001).rename('magNBR');

// Compute magnitude per year (avoid division by zero)
var magPerYear = magNBR.divide(changeImg.select('dur').max(1)).rename('mag_per_year');

// Reclassify duration: 1 year, 2 years, >=3 years (0 = no disturbance)
var durReclass = changeImg.select('dur').expression(
  "((d >= 3) ? 3 : ((d >= 2) ? 2 : ((d >= 1) ? 1 : 0)))",
  {d: changeImg.select('dur')}
).rename('durReclass');

// Visualize raw magnitude
Map.addLayer(
  changeImg.select(['mag']),
  {min: 200, max: 800, palette: ['#9400D3','#4B0082','#0000FF','#00FF00','#FFFF00','#FF7F00','#FF0000']},
  'Magnitude'
);

// Visualize recovered NBR magnitude
Map.addLayer(
  magNBR,
  {min: 0, max: 0.8, palette: ['white','red']},
  'Mag in NBR'
);

// Visualize magnitude per year (NBR/year)
Map.addLayer(
  magPerYear,
  {min: 0, max: 0.2, palette: ['white','purple']},
  'Mag per Year (NBR/year)'
);

// Visualize Year of Detection
Map.addLayer(
  changeImg.select(['yod']),
  {min: startYear, max: endYear, palette: ['blue','cyan','green','yellow','red']},
  'Year of Detection'
);

// Visualize original Duration
Map.addLayer(
  changeImg.select(['dur']),
  {min: 0, max: 10, palette: ['white','gray','black']},
  'Duration'
);

// Visualize reclassified Duration
Map.addLayer(
  durReclass,
  {min: 0, max: 3, palette: ['white','blue','green','red']},
  'Duration Reclass (1,2,>=3 years)'
);

// Export results

// Export NBR-recovered magnitude (float32)
Export.image.toDrive({
  image: magNBR.unmask(0).float(),
  description: 'mag_NBR_' + startYear + '_' + (endYear - 1),
  folder: 'LandTrendr_export',
  region: roi,
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13
});

// Export Year of Detection (int16)
Export.image.toDrive({
  image: changeImg.select('yod').unmask(0).short(),
  description: 'yod_' + startYear + '_' + (endYear - 1),
  folder: 'LandTrendr_export',
  region: roi,
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13
});

// Export reclassified duration (int16)
Export.image.toDrive({
  image: durReclass.unmask(0).short(),
  description: 'durReclass_' + startYear + '_' + (endYear - 1),
  folder: 'LandTrendr_export',
  region: roi,
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13
});

// Export magnitude per year (float32)
Export.image.toDrive({
  image: magPerYear.unmask(0).float(),
  description: 'mag_per_year_' + startYear + '_' + (endYear - 1),
  folder: 'LandTrendr_export',
  region: roi,
  scale: 30,
  crs: 'EPSG:32649',
  maxPixels: 1e13
});

// ================================================================
// SVM training for disturbance duration prediction (classes 1,2,3)
// ================================================================

// 1. SVM training function (trains directly from FeatureCollection)
function trainSVMFromFeatureCollection(trainingDataFC, sensorIdentifier, inputFeatureProperties, classProperty) {
  if (!trainingDataFC || !(trainingDataFC instanceof ee.FeatureCollection)) {
    print('Error (' + sensorIdentifier + '): FeatureCollection invalid or wrong type.');
    return null;
  }
  if (trainingDataFC.size().getInfo() === 0) {
    print('Error (' + sensorIdentifier + '): FeatureCollection is empty.');
    return null;
  }

  var inputProps_ee = ee.List(inputFeatureProperties);
  var firstFeature = trainingDataFC.first();
  if (!firstFeature) {
      print('Error (' + sensorIdentifier + '): FeatureCollection.first() returned null despite size > 0.');
      return null;
  }
  
  var featurePropertiesList = firstFeature.propertyNames();
  var allPropsPresent = featurePropertiesList.containsAll(inputProps_ee).getInfo();
  var classPropPresent = featurePropertiesList.contains(classProperty).getInfo();

  if (!allPropsPresent || !classPropPresent) {
    print('Error (' + sensorIdentifier + '): FeatureCollection missing required feature or class properties.');
    if (!allPropsPresent) print('  Requested feature properties may not all exist:', inputProps_ee);
    if (!classPropPresent) print('  Requested class property missing:', classProperty);
    print('  Actual sample properties:', featurePropertiesList);
    return null;
  }
  
  print('Debug (' + sensorIdentifier + '): requested feature properties:', inputProps_ee);
  print('Debug (' + sensorIdentifier + '): class property for training:', classProperty);

  var currentTrainingData = trainingDataFC;
  print(sensorIdentifier + ' - unique values and counts of target "' + classProperty + '" (before split):', currentTrainingData.aggregate_histogram(classProperty));

  if (currentTrainingData.size().getInfo() < 20){
    print('Error (' + sensorIdentifier + '): fewer than 20 valid training samples. Count: ' + currentTrainingData.size().getInfo() + '. Skipping.');
    return null;
  }

  var trainingFraction = 0.7;
  currentTrainingData = currentTrainingData.randomColumn('random_split_main', 12345);
  var trainingPartition = currentTrainingData.filter(ee.Filter.lt('random_split_main', trainingFraction));
  var testingPartition = currentTrainingData.filter(ee.Filter.gte('random_split_main', trainingFraction));

  print('Training partition size (' + sensorIdentifier + '):', trainingPartition.size());
  print('Testing partition size (' + sensorIdentifier + '):', testingPartition.size());

  var minSamplesInPartition = 5;
  if (trainingPartition.size().getInfo() < minSamplesInPartition || testingPartition.size().getInfo() < minSamplesInPartition) {
    print('Error (' + sensorIdentifier + '): train or test partition has too few samples (need at least ' + minSamplesInPartition + ').');
    print('Train size: ' + trainingPartition.size().getInfo());
    print('Test size: ' + testingPartition.size().getInfo());
    print('Consider increasing initial sample count or checking per-class sample distribution.');
    return null;
  }

  var svmParameters = {
    kernelType: 'RBF', gamma: 0.5, cost: 10,
    svmType: 'C_SVC', decisionProcedure: 'Voting'
  };

  print('Training SVM classifier ('+ sensorIdentifier +')...');
  var classifier = ee.Classifier.libsvm(svmParameters).train({
    features: trainingPartition,
    classProperty: classProperty,
    inputProperties: inputProps_ee
  });
  
  return {
    classifier: classifier, testingPartition: testingPartition,
    inputFeaturePropertiesUsed: inputProps_ee, classPropertyUsed: classProperty
  };
}


// 2. Prepare image for sampling (features + target)
var bandsForSvmFeatures_Dur_filtered = ['blue','green','red','nir','swir1','swir2','thermal'];
var targetDurBandName_Dur_filtered = 'target_dur_reclass';

var imageToSampleForDurPrediction_filtered = composite8.select(bandsForSvmFeatures_Dur_filtered)
                                    .addBands(durReclass.rename(targetDurBandName_Dur_filtered));

print('Image ready for sampling (features from composite8, target = durReclass):', imageToSampleForDurPrediction_filtered);


// 3. Create training and testing samples (FeatureCollection), classes 1,2,3 only
var initialNumPixelsToSample_Dur = 20000; // oversample to allow for class-0 filtering
print('Planning to sample ' + initialNumPixelsToSample_Dur + ' pixels initially...');

var samplesForAllClasses = imageToSampleForDurPrediction_filtered.sample({
  region: roi, scale: 30,
  numPixels: initialNumPixelsToSample_Dur,
  seed: 42, geometries: false
});

// Filter out null-valued samples
var allBandsForFiltering_Dur_filtered = ee.List(bandsForSvmFeatures_Dur_filtered).add(targetDurBandName_Dur_filtered);
samplesForAllClasses = samplesForAllClasses.filter(ee.Filter.notNull(allBandsForFiltering_Dur_filtered));
print('After initial sampling, valid sample count (all classes):', samplesForAllClasses.size());

// Filter out class 0, keep only classes 1, 2, and 3
var samplesForDurPrediction_filtered = samplesForAllClasses
                                        .filter(ee.Filter.gte(targetDurBandName_Dur_filtered, 1));

print('Final valid sample count for SVM duration prediction (classes 1,2,3 only):', samplesForDurPrediction_filtered.size());
// Debug: inspect one sample and class histogram
if (samplesForDurPrediction_filtered.size().getInfo() > 0) {
  print('Example sample (classes 1,2,3):', samplesForDurPrediction_filtered.first());
  print('Class distribution (1,2,3):', samplesForDurPrediction_filtered.aggregate_histogram(targetDurBandName_Dur_filtered));
} else {
  print('Warning: no samples remain after filtering (classes 1,2,3). Check LandTrendr results or increase initial sample count.');
}


// 4. Train SVM and evaluate (classes 1, 2, 3)
print('Starting SVM training and evaluation, target: ' + targetDurBandName_Dur_filtered + ' (classes 1,2,3 only)');

var svmDurPredictionAssets_filtered = trainSVMFromFeatureCollection(
  samplesForDurPrediction_filtered,
  'SVM_for_DurReclass_123',
  bandsForSvmFeatures_Dur_filtered,
  targetDurBandName_Dur_filtered
);

if (svmDurPredictionAssets_filtered && svmDurPredictionAssets_filtered.classifier && svmDurPredictionAssets_filtered.testingPartition) {
  var svmDurClassifier_filtered = svmDurPredictionAssets_filtered.classifier;
  var svmDurTestingData_filtered = svmDurPredictionAssets_filtered.testingPartition;
  var classPropertyActual_Dur_filtered = svmDurPredictionAssets_filtered.classPropertyUsed;

  print('Evaluating SVM model (classes 1,2,3) on test set (' + svmDurTestingData_filtered.size().getInfo() + ' samples)...');
  var svmDurValidationResults_filtered = svmDurTestingData_filtered.classify(svmDurClassifier_filtered);
  var svmDurConfusionMatrix_filtered = svmDurValidationResults_filtered.errorMatrix(classPropertyActual_Dur_filtered, 'classification');
  
  print('SVM Disturbance Duration Prediction (classes 1,2,3) - Confusion Matrix:', svmDurConfusionMatrix_filtered);
  print('SVM Disturbance Duration Prediction (classes 1,2,3) - Overall Accuracy:', svmDurConfusionMatrix_filtered.accuracy());
  print('SVM Disturbance Duration Prediction (classes 1,2,3) - Kappa:', svmDurConfusionMatrix_filtered.kappa());

  print('Applying SVM to the full study area (predicting classes 1,2,3)...');
  // Note: classifier trained only on classes 1,2,3; areas originally class 0 will be forced into 1,2,3.
  var predictedDurImage_filtered = composite8.select(bandsForSvmFeatures_Dur_filtered)
                                .classify(svmDurClassifier_filtered)
                                .rename('svm_predicted_dur_123');

  // Visualization (classes 1, 2, 3)
  var durVizParams_SVM_filtered = {min: 1, max: 3, palette: ['0000FF','00FF00','#FF0000']}; // Blue, Green, Red
  Map.addLayer(predictedDurImage_filtered.clip(roi), durVizParams_SVM_filtered, 'SVM Predicted Dur (1,2,3 only)');

  var referenceDur0 = durReclass.eq(0); // original class-0 areas
  var finalCombinedMap = ee.Image(0) // default 0 (no disturbance)
                           .where(referenceDur0.not(), predictedDurImage_filtered); // use SVM prediction in non-0 areas
  Map.addLayer(finalCombinedMap.clip(roi),
               {min:0, max:3, palette: ['#CCCCCC','0000FF','00FF00','#FF0000']}, // Gray=0, Blue=1, Green=2, Red=3
               'SVM Predicted Dur (Combined 0,1,2,3)');

} else {
  print('SVM duration prediction (classes 1,2,3) failed. Check sample count and previous error messages.');
}
