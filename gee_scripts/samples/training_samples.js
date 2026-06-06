// FILE:       training_samples.js
// PURPOSE:    Hand-digitized training points for SVM LULC classification,
//             organized as 5 GEE Geometry Imports + study-area FeatureCollection.
// SOURCE:     Originally `ROI_POIs.js`
// CLASSES:    1 = water        (color: #0c5aff)
//             2 = builtUp      (color: #787878)
//             3 = unrestoredLand (color: #d63000)
//             4 = restoring    (color: #4bffe4)
//             5 = stableVegetation (color: #00eb25)
// AOI ASSET:  projects/ee-skyscanding/assets/Final_Reprojected_zxy
//             (bound to vars `table` and `cc`)
// USAGE:      Paste these `Start of imports` / `End of imports` blocks into
//             the GEE Code Editor as Geometry Imports, then any of the
//             classification scripts in this repo will pick them up by name.
// NOTES:      The `lc` attribute is left empty here ,  class codes are assigned
//             by `.map(f => f.set('lc', N))` in each consumer script.

/**** Start of imports. If edited, may not auto-convert in the playground. ****/
var stableVegetation = /* color: #00eb25 */ee.FeatureCollection(
        [ee.Feature(
            ee.Geometry.Point([113.70716172254535, 24.556688322252434]),
            {
              "lc": "",
              "system:index": "0"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70767670667621, 24.55844482528205]),
            {
              "lc": "",
              "system:index": "1"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70930748975726, 24.558874188946767]),
            {
              "lc": "",
              "system:index": "2"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7084491828725, 24.556434603114408]),
            {
              "lc": "",
              "system:index": "3"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70914782376116, 24.563883526197873]),
            {
              "lc": "",
              "system:index": "4"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71155078321885, 24.568773098174365]),
            {
              "lc": "",
              "system:index": "5"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70953376203965, 24.565611635479964]),
            {
              "lc": "",
              "system:index": "6"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71049935728502, 24.567055770308166]),
            {
              "lc": "",
              "system:index": "7"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71403987318467, 24.572447796308396]),
            {
              "lc": "",
              "system:index": "8"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7127309551854, 24.57080857737753]),
            {
              "lc": "",
              "system:index": "9"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71494552579286, 24.573758539596223]),
            {
              "lc": "",
              "system:index": "10"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71681234326722, 24.574461048081826]),
            {
              "lc": "",
              "system:index": "11"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71858491031004, 24.576127942882955]),
            {
              "lc": "",
              "system:index": "12"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71978653994871, 24.57796222761977]),
            {
              "lc": "",
              "system:index": "13"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72118128863646, 24.579484273288365]),
            {
              "lc": "",
              "system:index": "14"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72073067752196, 24.57813784921765]),
            {
              "lc": "",
              "system:index": "15"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72420809517139, 24.581259969860906]),
            {
              "lc": "",
              "system:index": "16"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72515223274463, 24.580908735173395]),
            {
              "lc": "",
              "system:index": "17"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72727610230186, 24.579122548533103]),
            {
              "lc": "",
              "system:index": "18"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72566677689292, 24.578205418016804]),
            {
              "lc": "",
              "system:index": "19"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72809149384238, 24.57904449513356]),
            {
              "lc": "",
              "system:index": "20"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72864939331748, 24.575922319271896]),
            {
              "lc": "",
              "system:index": "21"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72886397003867, 24.577424876118226]),
            {
              "lc": "",
              "system:index": "22"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7300493916896, 24.573176028890188]),
            {
              "lc": "",
              "system:index": "23"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72972752660782, 24.57481521685017]),
            {
              "lc": "",
              "system:index": "24"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73193766683609, 24.571868565977]),
            {
              "lc": "",
              "system:index": "25"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73074817110273, 24.568283685034114]),
            {
              "lc": "",
              "system:index": "26"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7331728880522, 24.566195559226742]),
            {
              "lc": "",
              "system:index": "27"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73207854677412, 24.5668981101107]),
            {
              "lc": "",
              "system:index": "28"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73450326372358, 24.56596137472366]),
            {
              "lc": "",
              "system:index": "29"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73433160234663, 24.56746405101446]),
            {
              "lc": "",
              "system:index": "30"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73368787218305, 24.56986439264882]),
            {
              "lc": "",
              "system:index": "31"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73669194627973, 24.568869134623483]),
            {
              "lc": "",
              "system:index": "32"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73772191454145, 24.567522596479336]),
            {
              "lc": "",
              "system:index": "33"
            }),
        ee.Feature(
            ee.Geometry.Point([113.74151999625806, 24.567108861192942]),
            {
              "lc": "",
              "system:index": "34"
            }),
        ee.Feature(
            ee.Geometry.Point([113.74154145393018, 24.566425826812996]),
            {
              "lc": "",
              "system:index": "35"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73744303855543, 24.566757586833877]),
            {
              "lc": "",
              "system:index": "36"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7449343754556, 24.5605715776547]),
            {
              "lc": "",
              "system:index": "37"
            }),
        ee.Feature(
            ee.Geometry.Point([113.74456959502957, 24.561996254538215]),
            {
              "lc": "",
              "system:index": "38"
            }),
        ee.Feature(
            ee.Geometry.Point([113.74316026493379, 24.557101171807215]),
            {
              "lc": "",
              "system:index": "39"
            }),
        ee.Feature(
            ee.Geometry.Point([113.74431897922823, 24.558408788764524]),
            {
              "lc": "",
              "system:index": "40"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73979139341776, 24.555962787270992]),
            {
              "lc": "",
              "system:index": "41"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7382678986973, 24.555591964673702]),
            {
              "lc": "",
              "system:index": "42"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73504924787943, 24.555904236407486]),
            {
              "lc": "",
              "system:index": "43"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73644399656717, 24.555045487268444]),
            {
              "lc": "",
              "system:index": "44"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73155164732401, 24.553093762809926]),
            {
              "lc": "",
              "system:index": "45"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73326826109354, 24.554928384657487]),
            {
              "lc": "",
              "system:index": "46"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7311521107467, 24.558604149855842]),
            {
              "lc": "",
              "system:index": "47"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72909217422327, 24.55899448002489]),
            {
              "lc": "",
              "system:index": "48"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72741847579798, 24.559037656239795]),
            {
              "lc": "",
              "system:index": "49"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72718244140466, 24.561457675331866]),
            {
              "lc": "",
              "system:index": "50"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72855573242029, 24.565007011558976]),
            {
              "lc": "",
              "system:index": "51"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72932820861658, 24.5633481795063]),
            {
              "lc": "",
              "system:index": "52"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72705782376913, 24.566108128410843]),
            {
              "lc": "",
              "system:index": "53"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72420395337728, 24.56784498436344]),
            {
              "lc": "",
              "system:index": "54"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72159729018611, 24.56888863410051]),
            {
              "lc": "",
              "system:index": "55"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7229276658575, 24.56920087271468]),
            {
              "lc": "",
              "system:index": "56"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71953296906503, 24.57252234745463]),
            {
              "lc": "",
              "system:index": "57"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7228589082435, 24.57219060269434]),
            {
              "lc": "",
              "system:index": "58"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72120666749032, 24.572385746777346]),
            {
              "lc": "",
              "system:index": "59"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71709838998865, 24.572366232382727]),
            {
              "lc": "",
              "system:index": "60"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72186942851582, 24.571009588779237]),
            {
              "lc": "",
              "system:index": "61"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7197236613039, 24.56970210326146]),
            {
              "lc": "",
              "system:index": "62"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7222022861823, 24.565408932518043]),
            {
              "lc": "",
              "system:index": "63"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72117231792058, 24.564257513939115]),
            {
              "lc": "",
              "system:index": "64"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72381407624967, 24.564025380107896]),
            {
              "lc": "",
              "system:index": "65"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72631499056702, 24.56452741006226]),
            {
              "lc": "",
              "system:index": "66"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72857791983468, 24.55140393091477]),
            {
              "lc": "",
              "system:index": "67"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72731191717965, 24.549237452009145]),
            {
              "lc": "",
              "system:index": "68"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7301657875715, 24.55077936425833]),
            {
              "lc": "",
              "system:index": "69"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73055202566964, 24.547514531147392]),
            {
              "lc": "",
              "system:index": "70"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72812254696214, 24.54148543527796]),
            {
              "lc": "",
              "system:index": "71"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72788651256883, 24.543749642346086]),
            {
              "lc": "",
              "system:index": "72"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72904522686326, 24.543339745819434]),
            {
              "lc": "",
              "system:index": "73"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73005373745286, 24.54511595443035]),
            {
              "lc": "",
              "system:index": "74"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7161258294741, 24.541142994242716]),
            {
              "lc": "",
              "system:index": "75"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71406207014813, 24.537721282053507]),
            {
              "lc": "",
              "system:index": "76"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71500620772137, 24.54265969125914]),
            {
              "lc": "",
              "system:index": "77"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71924301628844, 24.54128064093026]),
            {
              "lc": "",
              "system:index": "78"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71759077553527, 24.53614697727853]),
            {
              "lc": "",
              "system:index": "79"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71630331520812, 24.53456584465653]),
            {
              "lc": "",
              "system:index": "80"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71602436547057, 24.530700769957836]),
            {
              "lc": "",
              "system:index": "81"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71660372261779, 24.532418595626538]),
            {
              "lc": "",
              "system:index": "82"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71354339580402, 24.527964123285884]),
            {
              "lc": "",
              "system:index": "83"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71223447780476, 24.52601197758281]),
            {
              "lc": "",
              "system:index": "84"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71608871007685, 24.523321426506254]),
            {
              "lc": "",
              "system:index": "85"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72192519689325, 24.51777704845845]),
            {
              "lc": "",
              "system:index": "86"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72042315984491, 24.520080728210498]),
            {
              "lc": "",
              "system:index": "87"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72291224981073, 24.51650805427849]),
            {
              "lc": "",
              "system:index": "88"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72499364400629, 24.52099266702998]),
            {
              "lc": "",
              "system:index": "89"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72542279744867, 24.519411343566574]),
            {
              "lc": "",
              "system:index": "90"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72392076040033, 24.52555017021714]),
            {
              "lc": "",
              "system:index": "91"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72409242177729, 24.5238517725228]),
            {
              "lc": "",
              "system:index": "92"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72241688574289, 24.527253142364952]),
            {
              "lc": "",
              "system:index": "93"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72147274816965, 24.527018885156604]),
            {
              "lc": "",
              "system:index": "94"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70837244120456, 24.538204047427286]),
            {
              "lc": "",
              "system:index": "95"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70590480891086, 24.544543454062154]),
            {
              "lc": "",
              "system:index": "96"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70444568720676, 24.546749050808643]),
            {
              "lc": "",
              "system:index": "97"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70320114222385, 24.549462076806638]),
            {
              "lc": "",
              "system:index": "98"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70352300730563, 24.550730737893783]),
            {
              "lc": "",
              "system:index": "99"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70311531153537, 24.547432192378356]),
            {
              "lc": "",
              "system:index": "100"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70523962107517, 24.547139417875417]),
            {
              "lc": "",
              "system:index": "101"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70659145441867, 24.548927972738536]),
            {
              "lc": "",
              "system:index": "102"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70787891474582, 24.54842050255017]),
            {
              "lc": "",
              "system:index": "103"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70742830363132, 24.546702895910503]),
            {
              "lc": "",
              "system:index": "104"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7049392136655, 24.553511556163585]),
            {
              "lc": "",
              "system:index": "105"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71676847437865, 24.53901796683171]),
            {
              "lc": "",
              "system:index": "106"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7235490987683, 24.54026721414077]),
            {
              "lc": "",
              "system:index": "107"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72732564906127, 24.540384330438417]),
            {
              "lc": "",
              "system:index": "108"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7197296331311, 24.536948873621665]),
            {
              "lc": "",
              "system:index": "109"
            })]),
    table = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy"),
    cc = ee.FeatureCollection("projects/ee-skyscanding/assets/Final_Reprojected_zxy"),
    unrestoredLand = /* color: #d63000 */ee.FeatureCollection(
        [ee.Feature(
            ee.Geometry.Point([113.7114178304182, 24.54415621043417]),
            {
              "lc": "",
              "system:index": "0"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70892874045238, 24.552744182795]),
            {
              "lc": "",
              "system:index": "1"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71536604208812, 24.552587282069226]),
            {
              "lc": "",
              "system:index": "2"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71425024313793, 24.566561015716104]),
            {
              "lc": "",
              "system:index": "3"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72304788870677, 24.575971688730792]),
            {
              "lc": "",
              "system:index": "4"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72749672425293, 24.569063751291843]),
            {
              "lc": "",
              "system:index": "5"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72556553376221, 24.57366918552439]),
            {
              "lc": "",
              "system:index": "6"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72771130097412, 24.571893381357505]),
            {
              "lc": "",
              "system:index": "7"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72294936169102, 24.555826437408538]),
            {
              "lc": "",
              "system:index": "8"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71758494366124, 24.56062752040098]),
            {
              "lc": "",
              "system:index": "9"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71998820293858, 24.564296516799274]),
            {
              "lc": "",
              "system:index": "10"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71389504190965, 24.52551550164851]),
            {
              "lc": "",
              "system:index": "11"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72179807540672, 24.521415880683236]),
            {
              "lc": "",
              "system:index": "12"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7237936389138, 24.522391993051333]),
            {
              "lc": "",
              "system:index": "13"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71944412766143, 24.527621812469942]),
            {
              "lc": "",
              "system:index": "14"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71649654746668, 24.52902215734073]),
            {
              "lc": "",
              "system:index": "15"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71396389636871, 24.531875724496793]),
            {
              "lc": "",
              "system:index": "16"
            })]),
    water = /* color: #0c5aff */ee.FeatureCollection(
        [ee.Feature(
            ee.Geometry.Point([113.71701115203795, 24.526203651267895]),
            {
              "lc": "",
              "system:index": "0"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72166746688781, 24.523177770071314]),
            {
              "lc": "",
              "system:index": "1"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71305448192987, 24.53524154273186]),
            {
              "lc": "",
              "system:index": "2"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73845915390488, 24.557271723183657]),
            {
              "lc": "",
              "system:index": "3"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73412566485268, 24.563475273563515]),
            {
              "lc": "",
              "system:index": "4"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72569432653773, 24.572014742447614]),
            {
              "lc": "",
              "system:index": "5"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73895192966161, 24.562096468138847]),
            {
              "lc": "",
              "system:index": "6"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73405958041845, 24.55909096885263]),
            {
              "lc": "",
              "system:index": "7"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73092410888704, 24.5660015355377]),
            {
              "lc": "",
              "system:index": "8"
            })]),
    builtUp = /* color: #787878 */ee.FeatureCollection(
        [ee.Feature(
            ee.Geometry.Point([113.72902908017389, 24.554080888068103]),
            {
              "lc": "",
              "system:index": "0"
            }),
        ee.Feature(
            ee.Geometry.Point([113.726346871159, 24.556305834013603]),
            {
              "lc": "",
              "system:index": "1"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72372903516046, 24.55790620931864]),
            {
              "lc": "",
              "system:index": "2"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7285999267315, 24.55720360804139]),
            {
              "lc": "",
              "system:index": "3"
            }),
        ee.Feature(
            ee.Geometry.Point([113.73177566220514, 24.556149698743933]),
            {
              "lc": "",
              "system:index": "4"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72311001225353, 24.560140122662908]),
            {
              "lc": "",
              "system:index": "5"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72338896199108, 24.562228349344217]),
            {
              "lc": "",
              "system:index": "6"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72008684638944, 24.566148847130684]),
            {
              "lc": "",
              "system:index": "7"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72058037284818, 24.567495400034016]),
            {
              "lc": "",
              "system:index": "8"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71826669028988, 24.570595410981987]),
            {
              "lc": "",
              "system:index": "9"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72604378689722, 24.576835603589906]),
            {
              "lc": "",
              "system:index": "10"
            }),
        ee.Feature(
            ee.Geometry.Point([113.74198907161926, 24.564064880053678]),
            {
              "lc": "",
              "system:index": "11"
            }),
        ee.Feature(
            ee.Geometry.Point([113.74319540313897, 24.560080497062767]),
            {
              "lc": "",
              "system:index": "12"
            }),
        ee.Feature(
            ee.Geometry.Point([113.74415327802107, 24.564206941528766]),
            {
              "lc": "",
              "system:index": "13"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72855975966687, 24.567749032955906]),
            {
              "lc": "",
              "system:index": "14"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71411176996712, 24.53393846306422]),
            {
              "lc": "",
              "system:index": "15"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7217697956356, 24.525997718590247]),
            {
              "lc": "",
              "system:index": "16"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72492855044752, 24.52402194727395]),
            {
              "lc": "",
              "system:index": "17"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7143713757649, 24.523416766353655]),
            {
              "lc": "",
              "system:index": "18"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71861999484449, 24.522713971947773]),
            {
              "lc": "",
              "system:index": "19"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72411884503676, 24.516121308916492]),
            {
              "lc": "",
              "system:index": "20"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72132407300731, 24.52807905630354]),
            {
              "lc": "",
              "system:index": "21"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7181161510255, 24.528674454158008]),
            {
              "lc": "",
              "system:index": "22"
            })]),
    restoring = /* color: #4bffe4 */ee.FeatureCollection(
        [ee.Feature(
            ee.Geometry.Point([113.72190781461069, 24.549391557299916]),
            {
              "lc": "",
              "system:index": "0"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72607448274725, 24.541406014790816]),
            {
              "lc": "",
              "system:index": "1"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70963807917182, 24.535149670510112]),
            {
              "lc": "",
              "system:index": "2"
            }),
        ee.Feature(
            ee.Geometry.Point([113.7102818093354, 24.537374952213515]),
            {
              "lc": "",
              "system:index": "3"
            }),
        ee.Feature(
            ee.Geometry.Point([113.70865102625434, 24.54127885987372]),
            {
              "lc": "",
              "system:index": "4"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72888317818183, 24.546778775895966]),
            {
              "lc": "",
              "system:index": "5"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72669449562568, 24.54638840770696]),
            {
              "lc": "",
              "system:index": "6"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72412861164052, 24.55178152204362]),
            {
              "lc": "",
              "system:index": "7"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72286152203588, 24.5438395182628]),
            {
              "lc": "",
              "system:index": "8"
            }),
        ee.Feature(
            ee.Geometry.Point([113.72550455975333, 24.579238762359644]),
            {
              "lc": "",
              "system:index": "9"
            }),
        ee.Feature(
            ee.Geometry.Point([113.71207337646617, 24.539384742698036]),
            {
              "lc": "",
              "system:index": "10"
            })]);
/***** End of imports. If edited, may not auto-convert in the playground. *****/