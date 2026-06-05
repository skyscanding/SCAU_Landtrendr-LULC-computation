// FILE:       sentinel2_svm.js
// PURPOSE:    Single-year Sentinel-2 SR SVM LULC classification using
//             Cloud Score+ for cloud masking.
// SOURCE:     Originally `Sentinel_SVM.js`
// INPUTS:     - Training points: imported via training_samples.js
//             - AOI:             projects/ee-skyscanding/assets/Final_Reprojected_zxy
//             - Year:            hardcoded at `var year = 2018`
// OUTPUTS:    1 classified GeoTIFF to Drive folder `监督土地分类Sentinel版`:
//               - {year}_Sentinel2_SR_CSPlus_Classification_ZXY
// CLOUD MASK: COPERNICUS/S2_SR_HARMONIZED linked to GOOGLE/CLOUD_SCORE_PLUS;
//             keeps pixels with cs_cdf >= 0.30
// MODEL:      libsvm, RBF kernel, gamma=1, cost=100
// BANDS:      Blue, Green, Red, NIR, SWIR1, SWIR2 + NDVI, EVI, NDWI, NDBI,
//             MNDWI, FVC (12 features total)
// SCALE:      10 m, CRS EPSG:32649
// NOTE:       Contains a commented-out linear-fit gap-fill block (kept for
//             reference); current pipeline takes the unfilled median.

// AOI 设置
var cc = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy"); 
Map.addLayer(cc, {color: 'red'}, 'AOI 边界');
Map.centerObject(cc, 13);

var year = 2018;
//var cloudThreshold = 30;
var startDate = ee.Date.fromYMD(year, 1, 1);

// Cloud Score+ 相关参数
var CSPLUS_QA_BAND = 'cs_cdf'; // cs
var CSPLUS_CLEAR_THRESHOLD = 0.30;

// 1) 基础
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

// 2) 光谱指数计算
var sentinelOpticalBands = ['Blue','Green','Red','NIR','SWIR1','SWIR2'];
var indexBands = ['NDVI', 'EVI', 'NDWI', 'NDBI', 'MNDWI', 'FVC'];
var outputBandsDefault = sentinelOpticalBands.concat(indexBands);

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

//分类的东西
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

print('classNames 中 lc 的唯一值和数量:', classNames.aggregate_histogram('lc'));

// 4) Sentinel-2 SR 年均值合成函数 (使用 Cloud Score+ 进行掩膜)
function getSentinel2SRImage(startDate, region, clearScoreThreshold, csPlusQaBand) {
  var targetYear = ee.Date(startDate).get('year');
  var yearFilter = ee.Filter.calendarRange(targetYear, targetYear, 'year');
  var nodata = -9999;

  var s2OutputBands = sentinelOpticalBands.concat(indexBands);

  var dummyImg = ee.Image.constant(ee.List.repeat(nodata, sentinelOpticalBands.length))
                      .rename(sentinelOpticalBands)
                      .clip(region.geometry());

  // Sentinel-2 SR 影像集
  var s2SR_collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                        .filterBounds(region);

  // 影集
  var csPlus_collection = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

  // 按年筛选S2影像
  var s2SR_yearly = s2SR_collection.filter(yearFilter);
  print('调试: 年份 ' + targetYear.getInfo() + ' 在AOI内的原始S2影像数量 (应用掩膜前):', s2SR_yearly.size());

  // 将S2影像与Cloud Score+连接，并应用掩膜、缩放和重命名
  var s2SR_col_processed = s2SR_yearly
    .linkCollection(csPlus_collection, [csPlusQaBand]) // 连接两个集合
    .map(function(img) {
      // 应用Cloud Score+掩膜
      var maskedImg = img.updateMask(img.select(csPlusQaBand).gte(clearScoreThreshold));

      // 选择、缩放并重命名光学波段
      var opticalBandsScaled = maskedImg.select(['B2','B3','B4','B8','B11','B12'])
                                .multiply(0.0001) // 缩放到0-1反射率
                                .rename(['Blue','Green','Red','NIR','SWIR1','SWIR2']);
      return opticalBandsScaled.copyProperties(img, ['system:time_start']);
    });

  // 执行线性拟合和填充
function _executeLinearFitAndFill(imgToFill, bandsForFit, fillMedianImage, kernelToUse) {
  var fillSelected = fillMedianImage.select(bandsForFit);
  var imgSelected = imgToFill.select(bandsForFit); // 确保 imgToFill 至少包含这些波段
  var paired = fillSelected.addBands(imgSelected);

  var fit = paired.reduceNeighborhood({
    reducer: ee.Reducer.linearFit().forEach(bandsForFit),
    kernel: kernelToUse,
    inputWeight: 'mask'
  });

  // 关键检查：确保 fit 影像包含所有预期的 offset 和 scale 波段
  var expectedOffsetBands = bandsForFit.map(function(b) { return ee.String(b).cat('_offset'); });
  var expectedScaleBands = bandsForFit.map(function(b) { return ee.String(b).cat('_scale'); });
  var allExpectedFitBands = ee.List(expectedOffsetBands).cat(expectedScaleBands);
  var actualFitBands = fit.bandNames();

  var allFitBandsGenerated = allExpectedFitBands.map(function(expectedName) {
    return actualFitBands.contains(expectedName);
  }).reduce(ee.Reducer.and()); // 检查是否所有预期波段都存在

  // 定义 "true" 分支的逻辑 (如果 fit 正常生成了所有波段)
  // 使用 IIFE 来直接返回一个 ee.Image 计算结果
  var filledImageWhenFitGenerated = (function() {
    var offset = fit.select(expectedOffsetBands).rename(bandsForFit);
    var scaleFactor = fit.select(expectedScaleBands).rename(bandsForFit);
    // 使用 fillSelected (来自 fillMedianImage) 作为乘法和加法的基础
    var filledValues = fillSelected.multiply(scaleFactor).add(offset);
    // 使用 unmask 填充原始影像中对应波段的掩膜区域
    // 然后选择原始影像的所有波段，以保持影像结构完整性
    return imgToFill.unmask(filledValues, true).select(imgToFill.bandNames());
  })(); // 立即执行

  return ee.Image(ee.Algorithms.If(
    allFitBandsGenerated,
    filledImageWhenFitGenerated, // 直接传递 GEE 对象
    // 如果 fit 未能正常生成所有波段 (可能因为输入数据问题)，返回原始影像
    imgToFill
  ));
}
    //GapFill 辅助函数
  /*var kernel = ee.Kernel.square(10 * 10, 'meters', false); // kernel 可以定义在外部

  function GapFill(img, collectionForFill) {
  var timeStartObj = img.get('system:time_start');

  // 定义当 timeStartObj 存在时的计算逻辑 (整个结果是一个 ee.Image)
  var filledImageWhenTimeExists = (function() {
    var imgDate = ee.Date(timeStartObj);
    var bandsToFit = ee.List(img.bandNames()).filter(ee.Filter.inList('item', sentinelOpticalBands));

    // 条件2: 必须有光学波段需要填充
    return ee.Image(ee.Algorithms.If(
      bandsToFit.length().gt(0),
      // 条件2为真: bandsToFit 非空
      (function() { // IIFE for Condition 2 true branch
        var start = imgDate.advance(-2, 'year');
        var end = imgDate.advance(2, 'year');
        var fillSourceCollection = collectionForFill.filterDate(start, end);

        // 条件3: 必须有填充源影像
        return ee.Image(ee.Algorithms.If(
          fillSourceCollection.size().gt(0),
          // 条件3为真: fillSourceCollection 非空
          (function() { // IIFE for Condition 3 true branch
            var fillMedian = fillSourceCollection.median().select(sentinelOpticalBands);
            // 确定 fillMedian 和 img (通过bandsToFit) 之间的共同可用波段
            var commonBandsToUse = fillMedian.bandNames().filter(ee.Filter.inList('item', bandsToFit));

            // 条件4: 必须有共同波段进行拟合
            return ee.Image(ee.Algorithms.If(
              commonBandsToUse.length().gt(0),
              // 条件4为真: commonBandsToUse 非空, 执行核心填充
              _executeLinearFitAndFill(img, commonBandsToUse, fillMedian, kernel),
              // 条件4为假: 没有共同波段，返回原图
              img
            ));
          })(), // 立即执行
          // 条件3为假: fillSourceCollection 为空，返回原图
          img
        ));
      })(), // 立即执行
      // 条件2为假: bandsToFit 为空，返回原图
      img
    ));
  })(); // 立即执行

  // 服务器端逻辑开始
  return ee.Image(ee.Algorithms.If(
    timeStartObj, // 条件1: timeStartObj 存在 (GEE 服务器端对象)
    filledImageWhenTimeExists, // 如果条件1为真，使用上面定义的计算结果
    // 条件1为假: timeStartObj 为 null (服务器端判断)，返回原图
    img
  ));
}
  //GapFill函数就运行到这里
*/

  var s2_composite;
  if (s2SR_col_processed.size().gt(0).getInfo()) {
    print('s2SR_col_processed不是空集, 有这么多张图:', s2SR_col_processed.size());
    // print('GapFill之前的波段情况:', ee.Image(s2SR_col_processed.first())); // 如果 s2SR_col_processed 为空，first() 会报错

    // var s2_col_gapfilled = s2SR_col_processed.map(function(imgFromMap){ 
    //   print('Mapping GapFill onto imgFromMap:', imgFromMap); 
    //   return GapFill(imgFromMap, s2SR_col_processed);
    // });
    var s2_col_gapfilled = s2SR_col_processed; // 直接使用未填充的影像集
    var firstImage = ee.Image(s2_col_gapfilled.first());
    var bandsPresent = ee.Algorithms.If(
        s2_col_gapfilled.size().gt(0).and(firstImage.bandNames().size().gt(0)),
        true,
        false
    );

    s2_composite = ee.Image(ee.Algorithms.If(
      bandsPresent,
      s2_col_gapfilled.median().select(sentinelOpticalBands),
      dummyImg //没图就用dummy
    ));
    s2_composite = s2_composite.clip(region.geometry());
  } else {
    print('在AOI内找不到年份 ' + targetYear.getInfo() + ' 的Sentinel-2影像。');
    s2_composite = dummyImg;
  }

  s2_composite = addAllIndices(s2_composite).select(s2OutputBands);
  // 检查 s2_composite 是否是 dummyImg，或者处理后是否还有有效波段
  var isDummyCheck = ee.Algorithms.If(
      s2_composite.bandNames().size().gt(0).and(s2_composite.reduceRegion(ee.Reducer.max(), region.geometry(), 1000).values().get(0)), // 尝试读取一个值
      s2SR_col_processed.size().eq(0), // isDummy 原逻辑
      true // 如果没有波段或值，也认为是dummy
  );
  s2_composite = s2_composite.set('isDummy', isDummyCheck);


  return ee.Dictionary({
    'Sentinel2_SR': s2_composite
  });
}


// 5) 样本均衡与影像完整性检查
function getBalancedSamples(imageWithBands, featureCollection, scale, refBandName) {
  var samples = imageWithBands.sampleRegions({
    collection: featureCollection, properties: ['lc'], scale: scale, geometries: true
  });
  samples = samples.filter(ee.Filter.neq(refBandName, -9999));
  print('原始样本数量:', samples.size());
  var classValues = ee.List(samples.aggregate_array('lc')).distinct().sort();
  var balanced = ee.FeatureCollection(classValues.map(function(cls) {
    cls = ee.Number(cls);
    var classSamples = samples.filter(ee.Filter.eq('lc', cls));
    var count = classSamples.size();
    var desired = ee.Algorithms.If(count.gt(1500), 1500,
                  ee.Algorithms.If(count.lt(500), count, 500));
    return classSamples.randomColumn('rand').limit(ee.Number(desired), 'rand');
  }).flatten());
  print('均衡后样本数量:', balanced.size());
  return balanced;
}

function isImageComplete(image, region, refBandName) {
   var maskStats = image.mask().select(refBandName).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: region.geometry(), scale: 10, maxPixels: 1e13
  });
  return ee.Number(maskStats.get(refBandName));
}

// 6) SVM部分，非常重要）！！
function trainAndClassifySVM(imageWithBands, sensorIdentifier, bandsToClassify, trainingSamples, studyRegion) {
  if (!trainingSamples || trainingSamples.size().eq(0).getInfo()) {
    print('错误 (' + sensorIdentifier + '): 无训练样本或样本集为空。跳过分类。');
    return null;
  }
  if (!imageWithBands || imageWithBands.bandNames().size().eq(0).getInfo()) {
     print('错误 (' + sensorIdentifier + '): 输入影像为空或无波段。跳过分类。');
    return null;
  }
  if (imageWithBands.get('isDummy').getInfo()) {
    print('跳过分类 (' + sensorIdentifier + '): 输入为无数据影像。');
    return null;
  }
  var availableBands = imageWithBands.bandNames(); // 服务器端 ee.List
  var bandsToClassify_ee = ee.List(bandsToClassify); // 将JS数组转换为ee.List
  var nBandsRequired_check = bandsToClassify_ee.length(); // 需要的波段总数 (ee.Number)

  // 调试打印：输出 bandsToClassify_ee 和 availableBands
  print('调试 (' + sensorIdentifier + '): 请求分类的波段列表 (bandsToClassify_ee):', bandsToClassify_ee);
  print('调试 (' + sensorIdentifier + '):影像实际可用波段列表 (availableBands):', availableBands);

  // 之前的 map 结果（用于检视）
  var mappedContainsList_check = bandsToClassify_ee.map(function(bandName) {
    return availableBands.contains(ee.String(bandName)); // 返回 ee.Boolean (1 或 0)
  });
  print('调试 (' + sensorIdentifier + '): 波段存在性映射列表 (1为存在, 0为不存在):', mappedContainsList_check);
  
  // 修正 nBandsPresent_check 的计算方式：通过筛选并获取大小
  var presentBandsInList_check = bandsToClassify_ee.filter(
    ee.Filter.inList('item', availableBands) // 'item' 是ee.List元素的默认属性名
  );
  var nBandsPresent_check = presentBandsInList_check.size(); // 直接获取存在波段的数量 (ee.Number)
  
  print('调试 (' + sensorIdentifier + '): 实际筛选出的存在于影像中的请求波段列表 (presentBandsInList_check):', presentBandsInList_check);
  print('调试 (' + sensorIdentifier + '): 计算出的存在波段数量 (nBandsPresent_check):', nBandsPresent_check);
  print('调试 (' + sensorIdentifier + '): 总共需要的波段数量 (nBandsRequired_check):', nBandsRequired_check);

  var allBandsPresent_server_check = ee.Algorithms.If(
    nBandsRequired_check.eq(0),
    ee.Number(1).eq(1), 
    nBandsPresent_check.eq(nBandsRequired_check)
  );

  print('波段检查状态 (' + sensorIdentifier + '): 是否所有必需波段都存在? ', allBandsPresent_server_check);

  // 注意: getInfo() 会强制服务器端计算，如果用在循环或 map 中需要小心。
  if (!allBandsPresent_server_check.getInfo()) { 
    print('错误 (' + sensorIdentifier + '): 并非所有指定分类波段都存在于影像中。分类跳过。');
    print('详细错误信息 - 可用波段 (' + sensorIdentifier + '): ', availableBands);
    print('详细错误信息 - 请求分类波段 (' + sensorIdentifier + '): ', bandsToClassify_ee);
    return null;
  }

  var currentTrainingData = imageWithBands.select(bandsToClassify).sampleRegions({
    collection: trainingSamples, properties: ['lc'], scale: 10, tileScale: 16
  });
  currentTrainingData = currentTrainingData.filter(ee.Filter.neq(ee.List(bandsToClassify).get(0), null));

  print('currentTrainingData 中 lc 的唯一值和数量:', currentTrainingData.aggregate_histogram('lc'));

  if (currentTrainingData.size().lt(10).getInfo()){
    print('错误 (' + sensorIdentifier + '): 从影像采样后有效训练样本不足。数量: ' + currentTrainingData.size().getInfo());
    return null;
  }

  // 这里控制样本划分修改，选用来训练的量和用来测试的量，可以有交集
  var trainingFraction = 0.8; // 约80%用于训练
  var testingFraction = 0.4;  // 约40%用于测试 (允许与训练集重叠)

  // 为训练集添加随机列并筛选
  // 使用不同的种子确保随机列的独立性，如果需要可重复的结果
  var trainingPartition = currentTrainingData.randomColumn('random_split_train', 1) // 添加名为 'random_split_train' 的随机列，种子为1
                                     .filter(ee.Filter.lt('random_split_train', trainingFraction));

  // 为测试集添加随机列并筛选
  var testingPartition = currentTrainingData.randomColumn('random_split_test', 2) // 添加名为 'random_split_test' 的随机列，种子为2
                                     .filter(ee.Filter.lt('random_split_test', testingFraction));

  print('训练样本分区数量 (' + sensorIdentifier + '):', trainingPartition.size());
  print('测试样本分区数量 (' + sensorIdentifier + '):', testingPartition.size());
  // 样本划分修改结束


  if (trainingPartition.size().eq(0).getInfo() || testingPartition.size().eq(0).getInfo()) {
    print('错误 (' + sensorIdentifier + '): 训练或测试分区在随机划分后为空。请检查样本数据和划分比例。');
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
  // SVM 参数修改结束

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

var classificationBands = ['Blue','Green','Red','NIR','SWIR1','SWIR2', 'NDVI','EVI','NDWI','NDBI','MNDWI','FVC'];

// 7) 主分类调用函数 (适配Sentinel-2)
// 在 performSentinel2Classification 函数内部
function performSentinel2Classification(sensorId, bandsForClf, trainingDataFc, studyAreaGeo, s2ImageDict) {
  var imageObject = s2ImageDict.get(sensorId);
  if (!imageObject) {
    print('影像为空: ' + sensorId);
    return null;
  }
  var image = ee.Image(imageObject);
  var imageBands = image.bandNames(); 
  var bandsForClf_ee = ee.List(bandsForClf);
  var nBandsRequired = bandsForClf_ee.length();

  // 调试打印
  // print('调试 (调用 ' + sensorId + ' 分类前): 请求分类的波段列表 (bandsForClf_ee):', bandsForClf_ee);
  // print('调试 (调用 ' + sensorId + ' 分类前): 影像实际可用波段列表 (imageBands):', imageBands);
  
  // 修正 nBandsPresent 的计算方式：通过筛选并获取大小
  var presentBandsInList = bandsForClf_ee.filter(
    ee.Filter.inList('item', imageBands)
  );
  var nBandsPresent = presentBandsInList.size();
  
  // print('调试 (调用 ' + sensorId + ' 分类前): 计算出的存在波段数量 (nBandsPresent):', nBandsPresent);
  // print('调试 (调用 ' + sensorId + ' 分类前): 总共需要的波段数量 (nBandsRequired):', nBandsRequired);

  var allBandsPresent_server = ee.Algorithms.If(
    nBandsRequired.eq(0),
    ee.Number(1).eq(1), 
    nBandsPresent.eq(nBandsRequired)
  );
  
  // print('调用 ' + sensorId + ' 分类前，波段检查状态: ', allBandsPresent_server);

  if (!allBandsPresent_server.getInfo()) { 
    print('无法分类 ' + sensorId + ': 合成影像中未包含所有必需波段。');
    // 在此打印详细信息
    print('详细错误信息 - 可用波段 (' + sensorId + '): ', imageBands);
    print('详细错误信息 - 请求分类波段 (' + sensorId + '): ', bandsForClf_ee);
    return null;
  }
  return trainAndClassifySVM(image, sensorId, bandsForClf, trainingDataFc, studyAreaGeo);
}


// 8) 生成年度Sentinel-2影像并分类
print("生成 " + year + " 年 Sentinel-2 SR 合成影像");
var sentinel2_SR_images = getSentinel2SRImage(startDate, cc, CSPLUS_CLEAR_THRESHOLD, CSPLUS_QA_BAND);

print("分类 Sentinel-2 SR 合成影像");
var Sentinel2_SR_classified = null;
if (classNames.size().gt(0).getInfo()){
    Sentinel2_SR_classified = performSentinel2Classification(
                                'Sentinel2_SR',
                                classificationBands,
                                classNames,
                                cc,
                                sentinel2_SR_images
                              );
} else {
    print("跳过分类：未定义训练样本(classNames)或样本集为空。");
}


// 9) 导出分类结果
var exportFolder = '监督土地分类Sentinel版';
var yearString = ee.Number(year).format('%04d').getInfo();

if (Sentinel2_SR_classified) {
  var imageToExport = Sentinel2_SR_classified;
  var descriptionBase = yearString + '_Sentinel2_SR_CSPlus_Classification_ZXY';

  Export.image.toDrive({
    image: imageToExport.toByte(),
    description: descriptionBase,
    fileNamePrefix: descriptionBase,
    folder: exportFolder,
    region: cc.geometry(),
    scale: 10, 
    crs: 'EPSG:32649',
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF'
  });
  print("已创建导出任务: " + descriptionBase);
} else {
  print("没有 " + yearString + " 年的 Sentinel-2 SR 分类影像可供导出。");
}