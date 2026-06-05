// =============================================================================
// FILE:       landsat_svm.js
// PURPOSE:    Single-year Landsat 7/8/9 SVM LULC classification (SR + TOA).
// SOURCE:     Originally `Landsat_SVM1.js`
// INPUTS:     - Training points: imported via training_samples.js
//             - AOI:             projects/ee-skyscanding/assets/Final_Reprojected_zxy
//             - Year:            hardcoded at `var year = 2014`
// OUTPUTS:    Up to 4 classified GeoTIFFs to Drive folder
//             `ZXY研究区监督土地分类_Landsa新用SVM`:
//               - {year}_Landsat7_SR_Classification_SVM_Advanced
//               - {year}_Landsat89_SR_Classification_SVM_Advanced
//               - {year}_Landsat7_TOA_Classification_SVM_Advanced
//               - {year}_Landsat89_TOA_Classification_SVM_Advanced
// MODEL:      libsvm, RBF kernel, gamma=1, cost=100
// BANDS:      Blue, Green, Red, NIR, SWIR1, SWIR2 + NDVI, EVI, NDWI, NDBI,
//             MNDWI, FVC (12 features total)
// SCALE:      30 m, CRS EPSG:32649
// =============================================================================

// 0) 基础设置与 AOI
var cc = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy");
Map.addLayer(cc, {color: 'orange'}, 'AOI 边界');
Map.centerObject(cc, 13);

var year = 2014;
var cloudThreshold = 20;
var startDate = ee.Date.fromYMD(year, 1, 1);

//基础函数
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

// 各种指数
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


//分类要素
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
print("总样本点数量 (合并后):", classNames.size());
print("classNames 中 lc 的唯一值和数量 (合并后):", classNames.aggregate_histogram('lc'));


//云掩膜
// MODIFIED: 云掩膜函数 - 统一逻辑，放宽对L8/9卷云的限制
function cloudMask(image, sensor) { // 添加 sensor 参数用于区分 L7 和 L8/9 的波段名
// 提取关键的QA位
var qa = image.select('QA_PIXEL');
var fill = qa.bitwiseAnd(1 << 0).neq(0); // Bit 0: Fill
var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0); // Bit 1: Dilated Cloud / Expanded Cloud
var cloud = qa.bitwiseAnd(1 << 3).neq(0); // Bit 3: Cloud
var cloudShadow = qa.bitwiseAnd(1 << 4).neq(0); // Bit 4: Cloud Shadow
// Bit 2 (Cirrus for L8/9, Unused for L7) is now NOT explicitly used to mask out pixels.
// We only care that the above "bad" conditions are false.

var badConditions = fill.or(dilatedCloud).or(cloud).or(cloudShadow);
var qaMask = badConditions.not(); // Good pixels are those where badConditions are false

var opticalBands;
var thermalBand;

if (sensor === 'L7') {
opticalBands = image.select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5','SR_B7'])
.multiply(0.0000275).add(-0.2)
.rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
thermalBand = image.select('ST_B6')
.multiply(0.00341802).add(149.0)
.rename('LST');
}else { // L8 or L9
opticalBands = image.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6','SR_B7']) // L8/9 use SR_B2 for Blue
.multiply(0.0000275).add(-0.2)
.rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
thermalBand = image.select(['ST_B10']) // L8/9 use ST_B10 for Thermal
.multiply(0.00341802).add(149.0)
.rename('LST');
}var satMask = image.select('QA_RADSAT').eq(0); // Saturation mask for SR products

return image.addBands(opticalBands, null, true)
.addBands(thermalBand, null, true)
.updateMask(qaMask)
.updateMask(satMask) // Apply saturation mask
.select(['Blue','Green','Red','NIR','SWIR1','SWIR2','LST']);
}
// MODIFIED: TOA云掩膜函数 - 统一逻辑，放宽对L8/9卷云的限制
function cloudMaskTOA(image, sensor) {
var qa = image.select('QA_PIXEL');
var fill = qa.bitwiseAnd(1 << 0).neq(0);
var dilatedCloud = qa.bitwiseAnd(1 << 1).neq(0);
var cloud = qa.bitwiseAnd(1 << 3).neq(0);
var cloudShadow = qa.bitwiseAnd(1 << 4).neq(0);
var badConditions = fill.or(dilatedCloud).or(cloud).or(cloudShadow);
var qaMask = badConditions.not();

var opticalBands;
var thermalBand;

if (sensor === 'L7') {
opticalBands = image.select(['B1','B2','B3','B4','B5','B7'])
.rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
thermalBand = image.select('B6_VCID_2').rename('LST');
}else { // L8 or L9
opticalBands = image.select(['B2','B3','B4','B5','B6','B7']) // L8/9 TOA use B2 for Blue
.rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
thermalBand = image.select(['B10']).rename('LST'); // L8/9 TOA use B10 for Thermal
}
return image.addBands(opticalBands, null, true)
.addBands(thermalBand, null, true)
.updateMask(qaMask)
.select(['Blue','Green','Red','NIR','SWIR1','SWIR2','LST']);
}

// MODIFIED: SR和TOA一起用均值合成 (现在是中位数合成)
function getLandsatSRImage(startDate, cloudThreshold, region) {
var nodata = -9999;
var bandTemplate = ['Blue','Green','Red','NIR','SWIR1','SWIR2','LST'];
var L7_SR_col = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold)) // Use CLOUD_COVER_LAND for better scene filtering
.map(function(img){ return cloudMask(img, 'L7'); });
var L8_SR_col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
.map(function(img){ return cloudMask(img, 'L8'); });
var L9_SR_col = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER_LAND', cloudThreshold))
.map(function(img){ return cloudMask(img, 'L9'); });
var L89_SR_col = L8_SR_col.merge(L9_SR_col);
var y = ee.Date(startDate).get('year');
var yearFilter = ee.Filter.calendarRange(y, y, 'year');
// MODIFIED: annualComposite function now uses median
function annualComposite(col, fillImg) {
var filteredForYear = col.filter(yearFilter);
var comp;

if (filteredForYear.size().gt(0).getInfo()) {
comp = filteredForYear.median().clip(region.geometry());
comp = comp.set('isDummy', false); // Mark as not dummy
print('成功为 ' + y.getInfo() + ' 年合成了中位数影像，使用影像数量: ' + filteredForYear.size().getInfo());
}else {
comp = fillImg; // fillImg is already marked as dummy
print('影像不足，为 ' + y.getInfo() + ' 年使用dummy影像。');
}// Apply focal_median for smoothing
comp = ee.Image(comp); // Ensure it's an image
comp = comp.focal_median(1, 'circle', 'pixels', 3);
return comp.select(bandTemplate).set('isDummy', comp.get('isDummy'));
}var dummy = ee.Image.constant(ee.List.repeat(nodata, bandTemplate.length))
.rename(bandTemplate)
.clip(region.geometry())
.set('isDummy', true); // Mark as dummy
var L7_comp = annualComposite(L7_SR_col, dummy);
var L89_comp = annualComposite(L89_SR_col, dummy);
return ee.Dictionary({
'Landsat7_SR': L7_comp.set('year', y),
'Landsat89_SR': L89_comp.set('year', y)
});
}
function getLandsatTOAImage(startDate, cloudThreshold, region) {
var nodata = -9999;
var bandTemplate = ['Blue','Green','Red','NIR','SWIR1','SWIR2','LST'];
var L7_TOA_col = ee.ImageCollection('LANDSAT/LE07/C02/T1_TOA')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold)) // TOA might not have CLOUD_COVER_LAND, use CLOUD_COVER
.map(function(img){ return cloudMaskTOA(img, 'L7'); });
var L8_TOA_col = ee.ImageCollection('LANDSAT/LC08/C02/T1_TOA')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
.map(function(img){ return cloudMaskTOA(img, 'L8'); });
var L9_TOA_col = ee.ImageCollection('LANDSAT/LC09/C02/T1_TOA')
.filterBounds(region)
.filter(ee.Filter.lt('CLOUD_COVER', cloudThreshold))
.map(function(img){ return cloudMaskTOA(img, 'L9'); });
var L89_TOA_col = L8_TOA_col.merge(L9_TOA_col);
var y = ee.Date(startDate).get('year');
var yearFilter = ee.Filter.calendarRange(y, y, 'year');
// MODIFIED: annualComposite function now uses median (same as SR version)
function annualComposite(col, fillImg) {
var filteredForYear = col.filter(yearFilter);
var comp;

if (filteredForYear.size().gt(0).getInfo()) {
comp = filteredForYear.median().clip(region.geometry());
comp = comp.set('isDummy', false);
print('成功为 (TOA) ' + y.getInfo() + ' 年合成了中位数影像，使用影像数量: ' + filteredForYear.size().getInfo());
}else {
comp = fillImg;
print('影像不足，为 (TOA) ' + y.getInfo() + ' 年使用dummy影像。');
}comp = ee.Image(comp);
comp = comp.focal_median(1, 'circle', 'pixels', 3);
return comp.select(bandTemplate).set('isDummy', comp.get('isDummy'));
}var dummy = ee.Image.constant(ee.List.repeat(nodata, bandTemplate.length))
.rename(bandTemplate).clip(region.geometry()).set('isDummy', true);
var L7_comp = annualComposite(L7_TOA_col, dummy);
var L89_comp = annualComposite(L89_TOA_col, dummy);
return ee.Dictionary({
'Landsat7_TOA': L7_comp.set('year', y),
'Landsat89_TOA': L89_comp.set('year', y)
});
}


//SVM部分，重要
function trainAndClassifySVM(imageWithBands, sensorIdentifier, bandsToClassify, trainingSamples, studyRegion) {
  // 检查 trainingSamples 是否有效 (FeatureCollection 且非空)
  if (!trainingSamples || !(trainingSamples instanceof ee.FeatureCollection) || trainingSamples.size().eq(0).getInfo()) {
    print('错误 (' + sensorIdentifier + '): 无训练样本、类型错误或样本集为空。跳过分类。传入的 trainingSamples:', trainingSamples);
    return null;
  }
  // 检查 imageWithBands 是否有效 (Image 且有波段)
  if (!imageWithBands || !(imageWithBands instanceof ee.Image) || imageWithBands.bandNames().size().eq(0).getInfo()) {
    print('错误 (' + sensorIdentifier + '): 输入影像为空、类型错误或无波段。跳过分类。传入的 imageWithBands:', imageWithBands);
    return null;
  }
  // 检查影像是否为dummy影像
  var isDummy = imageWithBands.get('isDummy');
  if (ee.Algorithms.IsEqual(isDummy, true).getInfo() || ee.Algorithms.IsEqual(isDummy, 1).getInfo()) {
    print('跳过分类 (' + sensorIdentifier + '): 输入为无数据影像 (isDummy is true)。');
    return null;
  }

  var availableBands = imageWithBands.bandNames();
  var bandsToClassify_ee = ee.List(bandsToClassify);

  // 波段检查 (确保所有请求的分类波段都存在于影像中)
  var presentBands = bandsToClassify_ee.filter(ee.Filter.inList('item', availableBands));
  if (presentBands.size().neq(bandsToClassify_ee.size()).getInfo()) {
    print('错误 (' + sensorIdentifier + '): 并非所有指定分类波段 (' + bandsToClassify_ee.join(', ') +
          ') 都存在于影像中。可用波段: ' + availableBands.join(', ') + '。分类跳过。');
    return null;
  }
  
  print('调试 (' + sensorIdentifier + '): 请求分类的波段列表:', bandsToClassify_ee);
  print('调试 (' + sensorIdentifier + '): 影像实际可用波段列表:', availableBands);

  // 从影像采样，使用 trainingSamples 中的 'lc' 属性
  var currentTrainingData = imageWithBands.select(bandsToClassify_ee) 
                                    .sampleRegions({
                                      collection: trainingSamples, 
                                      properties: ['lc'], 
                                      scale: 30,               
                                      tileScale: 4// 增加 tileScale
                                    });
  
  // 过滤掉采样后第一个分类波段为null的样本 (这可能不够，最好是所有波段都有效)
  currentTrainingData = currentTrainingData.filter(ee.Filter.neq(bandsToClassify_ee.get(0), null));
  // 同时确保 'lc' 属性存在且不为 null
  currentTrainingData = currentTrainingData.filter(ee.Filter.neq('lc', null));


  print('currentTrainingData 中 lc 的唯一值和数量 (采样后):', currentTrainingData.aggregate_histogram('lc'));

  if (currentTrainingData.size().lt(10).getInfo()){ // 确保有足够的样本
    print('错误 (' + sensorIdentifier + '): 从影像采样后有效训练样本不足10个。数量: ' + currentTrainingData.size().getInfo() + "。跳过分类。");
    return null;
  }

  // 这里控制样本划分修改，选用来训练的量和用来测试的量，可以有交集
  var trainingFraction = 0.8;
  var testingFraction = 0.4;

  var trainingPartition = currentTrainingData.randomColumn('random_split_train', 1)
                                     .filter(ee.Filter.lt('random_split_train', trainingFraction));
  var testingPartition = currentTrainingData.randomColumn('random_split_test', 2)
                                     .filter(ee.Filter.lt('random_split_test', testingFraction));

  print('训练样本分区数量 (' + sensorIdentifier + '):', trainingPartition.size());
  print('测试样本分区数量 (' + sensorIdentifier + '):', testingPartition.size());

  if (trainingPartition.size().lt(1).getInfo() || testingPartition.size().lt(1).getInfo()) { // 至少需要1个样本
    print('错误 (' + sensorIdentifier + '): 训练或测试分区在随机划分后为空或样本数不足。请检查样本数据和划分比例。跳过分类。');
    return null;
  }

  //这里控制着SVM的参数，从上到下顺序为核函数、γ、惩罚系数、svm类型、决策
  //要做回归的话改terminationEpsilon
  var svmParameters = {
    kernelType: 'RBF',//核函数
    gamma: 1,//γ值
    cost: 100,//惩罚系数C
    svmType: 'C_SVC', // svm类型，默认为分类类型
    decisionProcedure: 'Voting', // 默认为voting
    //terminationEpsilon: 0.01   // 设置 terminationEpsilon。C_SVC类型分类器用这个会报错，要注释掉，换成EPSILON_SVR 回归类型就可以用
                               // 对于 C_SVC 分类，此参数可能无效。
  };

  var classifier = ee.Classifier.libsvm(svmParameters).train({
    features: trainingPartition,
    classProperty: 'lc',//geometryimports里面调property的，由property决定
    inputProperties: bandsToClassify
  });
  // --- SVM 参数修改结束 ---

  var classifiedImage = imageWithBands.select(bandsToClassify).classify(classifier).clip(studyRegion.geometry());

  var testResults = testingPartition.classify(classifier); // 使用新的测试集进行精度评估
  var confusionMatrix = testResults.errorMatrix('lc', 'classification');

  print('testingPartition 中 lc 的唯一值和数量:', testingPartition.aggregate_histogram('lc'));
  print('testResults 中 classification 的唯一值和数量:', testResults.aggregate_histogram('classification')); 

  print('★ ' + sensorIdentifier + ' 混淆矩阵:', confusionMatrix);
  print('★ ' + sensorIdentifier + ' 总体精度:', confusionMatrix.accuracy());
  print('★ ' + sensorIdentifier + ' Kappa系数:', confusionMatrix.kappa());

  Map.addLayer(classifiedImage, {min:1, max:5, palette:['#FF8C00','#0000FF','#008000','#FFFF00','#800080']}, sensorIdentifier + ' 分类结果');
  return classifiedImage;
}

// 定义用于分类的波段列表 (包括指数)
var classificationBands = ['Blue','Green','Red','NIR','SWIR1','SWIR2', 'NDVI','EVI','NDWI','NDBI','MNDWI','FVC'];


// 修改后的 LandsatClassify 函数，以调用新的 trainAndClassifySVM
function LandsatClassify(sensorNameKey, // 例如 'Landsat7_SR'
                         bandsForClassification, // 应该是包含指数的12个波段列表
                         trainingSamplesFC, // 即 classNames
                         aoiRegion, 
                         landsatCompositesDict) {
  var imageToClassify = ee.Image(landsatCompositesDict.get(sensorNameKey));

  // 检查从字典获取的影像是否有效
  if (!imageToClassify || imageToClassify.bandNames().size().eq(0).getInfo()) { // 添加了对 bandNames().size() 的检查
    print('错误: 从字典中未能获取有效影像或影像无波段: ' + sensorNameKey + "。跳过分类。");
    // 尝试打印字典内容，帮助调试
    // print("传入的 landsatCompositesDict 内容:", landsatCompositesDict);
    // print("尝试获取的影像对象:", landsatCompositesDict.get(sensorNameKey));
    return null;
  }
  
  // 检查影像是否为 dummy (基于之前设置的 isDummy 属性)
  var isDummy = imageToClassify.get('isDummy');
   if (ee.Algorithms.IsEqual(isDummy, true).getInfo() || ee.Algorithms.IsEqual(isDummy, 1).getInfo()) {
    print('跳过分类 (' + sensorNameKey + '): 输入为无数据影像 (isDummy is true from composite)。');
    return null;
  }

  var imageWithIndices = addAllIndices(imageToClassify.select(['Blue','Green','Red','NIR','SWIR1','SWIR2']));

  return trainAndClassifySVM(
    imageWithIndices,       // 含有指数的影像
    sensorNameKey,          // 作为 sensorIdentifier
    bandsForClassification, // 使用全局的 classificationBands
    trainingSamplesFC,      // 即 classNames
    aoiRegion               // 即 cc
  );
}


print("--- 开始生成 " + year + " 年 Landsat SR 合成影像 ---");
var landsat_SR_Images_Dict = getLandsatSRImage(startDate, cloudThreshold, cc);
print("--- " + year + " 年 Landsat SR 合成影像生成完毕 ---", landsat_SR_Images_Dict);

print("--- 开始生成 " + year + " 年 Landsat TOA 合成影像 ---");
var landsat_TOA_Images_Dict = getLandsatTOAImage(startDate, cloudThreshold, cc);
print("--- " + year + " 年 Landsat TOA 合成影像生成完毕 ---", landsat_TOA_Images_Dict);

// 分类
print("--- 开始分类 ---");
var Landsat7_SR_class = LandsatClassify('Landsat7_SR', classificationBands, classNames, cc, landsat_SR_Images_Dict);
var Landsat89_SR_class = LandsatClassify('Landsat89_SR', classificationBands, classNames, cc, landsat_SR_Images_Dict);

var Landsat7_TOA_class = LandsatClassify('Landsat7_TOA', classificationBands, classNames, cc, landsat_TOA_Images_Dict);
var Landsat89_TOA_class = LandsatClassify('Landsat89_TOA', classificationBands, classNames, cc, landsat_TOA_Images_Dict);
print("--- 分类结束 ---");

//批量导出分类结果
var exportFolder = 'ZXY研究区监督土地分类_Landsa新用SVM'; 
var yStr = year.toString();

var outputList = [
  {name: yStr + '_Landsat7_SR', image: Landsat7_SR_class},     
  {name: yStr + '_Landsat89_SR', image: Landsat89_SR_class},
  {name: yStr + '_Landsat7_TOA', image: Landsat7_TOA_class},
  {name: yStr + '_Landsat89_TOA', image: Landsat89_TOA_class}
];

outputList.forEach(function(entry) {
  var imageToExport = entry.image;
  var descriptionName = entry.name + '_Classification_SVM_Advanced'; 

  if (imageToExport) { // 确保影像存在再导出
    print("准备导出: ", descriptionName);
    Export.image.toDrive({
      image: imageToExport.toByte(), // 确保分类结果是单波段整型，便于导出
      description: descriptionName,
      fileNamePrefix: descriptionName,
      folder: exportFolder,
      region: cc.geometry(),
      scale: 30,
      crs: 'EPSG:32649',
      maxPixels: 1e13,
      fileFormat: 'GeoTIFF'
    });
  } else {
    print("影像 " + entry.name + " 为空，跳过导出。");
  }
});