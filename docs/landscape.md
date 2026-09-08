# Landskap i Riviera

Landskapet använder samma oregelbundna celler som husen. Höjd och material lagras separat från husvåningarna så att marken kan ändras utan att bebyggelsen försvinner.

## Funktion och gränser

- Byggnader/Landskap, höj/sänk, materialmålning och utjämning ett steg mot grannarnas medelhöjd.
- Auto, Gräs, Klippa, Torr jord och Sand. Auto genererar gröna platåer, kustklippor, sandkanter och stödmurar nära hus.
- Stentrappor uppstår i obebyggda celler mellan lämpliga nivåer. Öppningen klipps ur markytan och kontrolleras mot cellens form.
- Vegetation, kuststenar och en redigerbar exempelby ingår. Befintliga sparningar ersätts inte vid uppdatering.
- Penseldrag grupperas till en ångra-operation. Pekskärm använder tryck för skulptering och två fingrar för kamera.
- Hus följer marken vertikalt. Takgrupper och dolda väggar beräknas vid gemensam absolut höjd.
- Mark ändras i halva husvåningar: 24 halvsteg upp till höjd 12; mark plus hus ryms inom 24 nivåer.
- Grottor, naturliga stenbågar, vingårdar och ett manuellt system för stigar ingår inte i denna version, enligt specens föreslagna avgränsning. Utjämningen ändrar cellhöjder; den är inte en kontinuerlig höjdfältspensel.

## Halvsteg, sluttningar och kustdetaljer

- Höj/sänk flyttar marken 0,5 husvåningar (0,58 världsenheter). Sparade heltal behåller sin tidigare höjd.
- Slutta kopplar en tom markcell till en lägre granne, med 0,5–1 vånings höjdskillnad. Upprepade klick växlar mellan lägre grannar och sedan plan mark. Hus får plana fundament; en befintlig sluttning tas bort när man bygger där.
- Höj på en klippvägg väljer den lägre, obebyggda granncellen. Detta gör hål möjliga att fylla utan att träffa deras botten. Måla, Sänk och Slutta väljer den träffade ytan.
- Trappor består av valbar stengeometri med slutna sidor, baksida och en anslutning till grannens kant. Hela öppningen och stegen använder samma koordinater.
- Sand och klippor går ner i havet med varierade strandprofiler. Vattenmaterialet animerar vit skumkant och svaga vågfronter på GPU:n. Kustens sammanhängande mask ritas om endast när strandens utbredning eller material ändras.
- Fyrar på små kajspetsar, parasoll och cafébord på vissa öppna platser, pinjer och blommande träd genereras deterministiskt. Tvättlinor kopplar två hus över en ledig ruta, svajar vid skapande och rör sig sedan svagt i vinden. Befintliga linors animation startas inte om vid andra ändringar.

## Data och rendering

`state.js` läser format 1 och 2. Format 2 innehåller `terrain: [[cellId, [height, material]], ...]`, där height även tillåter halvsteg. Sluttningar sparas som `[height, material, lowerEdge]`. Äldre sparningar är fortsatt kompatibla. Hela byn, inklusive marken, ingår i historik, autosparning och JSON-export.

`BuildEngine` gör granninvalidiering för både hus- och markändringar. Land, murar och dekorationer cachas per cell och överförs endast för ändrade områden. Husgeometrin genereras i lokala våningar och förskjuts med markhöjden; träffmetadata och bygganimationer behåller lokala våningsnummer.

En extra markbatch per aktivt område renderas med WebGPU. Vegetation och små rekvisita använder samma återanvända instansbuffertar och GPU-compute för matriser som resten av byn. Skuggor och AO använder markens riktiga geometri och djup. Gemensamma kantprofiler håller klippor, murar och marklock samman. Kustmasken uppdateras först när geometrin accepteras.

## Verifiering

- 32 kodtester, inklusive äldre byars byte-identiska geometri, sparformat, inkrementellt/färskt resultat, tak på olika markhöjd halvsteg, sluttningar och över 8 000 täckningsprov över trappceller.
- 17 befintliga WebGPU-interaktionskontroller passerar.
- 7 landskapsflöden passerar i produktionsbygget, även med 200 ms fördröjda workersvar: höj/sänk under hus, material, historik, drag, autosparning, export/import och mobil.
- 12 bildruteregessioner passerar med noll ändrade kontrollpixlar på oförändrade hus. Den tidigare instansfärgsblinkningen återkommer inte.
- 30 ångra/gör om-cykler per mätby (120 ombyggen totalt), korrekt GPU-matrisinnehåll och frigjorda världsbufferar efter radering.

## Ursprunglig mätning (före halvsteg och kustdetaljer)

Isolerad Chrome 151 på Windows, NVIDIA Lovelace-adapter, 1440 × 1000, pixelkvot 1, AO och skuggor aktiva. Värdena är medelvärden i ms; GPU anger summan av uppmätta render-/compute-pass, inte presentation eller köväntan.

| Scenario                      | CPU/bildruta | GPU-pass/bildruta | Geometrilatens | GPU-resurser |
| ----------------------------- | -----------: | ----------------: | -------------: | -----------: |
| Exempelby, stilla             |         1,67 |              1,05 |              – |     84,5 MiB |
| Exempelby, markändringar      |         2,09 |              1,12 |          18,27 |     84,5 MiB |
| 496 markceller, stilla        |         1,83 |              1,25 |              – |    101,6 MiB |
| 496 markceller, markändringar |         2,19 |              1,31 |          12,07 |    101,6 MiB |

Exempelbyn har 143 markceller och 91 husvåningar. Den stora mätbyn har 496 markceller, 288 husvåningar och cirka 26 000 instanser. Latens varierar med vilka takgrupper och grannar som påverkas; den mindre byn har därför inte alltid lägre bygglatens. Minnet var oförändrat mellan provpunkterna efter 6, 16 och 30 cykler.

Kör `node scripts/landscape.mjs` mot Vite eller produktionspreview. `WORKER_DELAY=200` simulerar långsamma workersvar. `node scripts/landscape-performance.mjs` använder produktionspreview på port 4173 och skriver rådata till `artifacts/landscape-performance.json`. `RIVIERA_URL` kan ange en annan lokal server.

Tvättlinorna använder en gemensam mesh med GPU-rörelse; fyrar och parasoll ligger i befintliga terräng- och instansbatcher. Kör `node scripts/coastal-features.mjs` för riktiga musprov av sluttningar, husfundament och klippval.

## Mätning efter kustuppdateringen

Chrome 151, AMD RDNA 3, 1440 × 1000 och pixelkvot 1, AO och skuggor på. Adaptern skiljer sig från den tidigare NVIDIA-mätningen, så GPU-tiderna ska inte jämföras direkt. Alla tider i ms.

| Scenario     | CPU/bildruta | GPU-pass/bildruta | Geometrilatens | GPU-resurser |
| ------------ | -----------: | ----------------: | -------------: | -----------: |
| demo-idle    |         1.70 |              4.51 |              – |     99.7 MiB |
| demo-sculpt  |         1.84 |              4.74 |          17.16 |     99.7 MiB |
| large-idle   |         2.03 |              5.35 |              – |    117.0 MiB |
| large-sculpt |         2.36 |              5.83 |          13.83 |    117.0 MiB |

Minnet var oförändrat efter 6, 16 och 30 ångra/gör om-cykler i båda byarna. GPU-matrisernas största avvikelse mot CPU-referensen var under 0,0000005. De nya objekten använder befintliga instansbatcher och tvättlinorna lägger till en gemensam mesh. 17 husbyggarprov, 7 landskapsflöden (även med 200 ms workerfördröjning), 4 nya kust-/sluttningsflöden och 12 bildruteregressioner passerade utan webbläsarfel.

## Manuell tvättlina

Knappen Tvätt under husfärgerna låter användaren välja två husvåningar. En förhandsvisning visar fästpunkterna. Samma huspar igen tar bort den manuella linan och hindrar en automatisk lina från att återuppstå där. Escape, högerklick eller samma första hus avbryter valet.

Manuella linor tillåter större mellanrum och andra riktningar än automatiken. Hus och mark längs sträckan kontrolleras innan placering. Fästena följer valda våningar och markhöjder. Format 2 sparar valfria clotheslines-poster [husA, våningA, husB, våningB]; två nollnivåer betyder en borttagen lina. Saknade fästen gör linan osynlig. Historik, export/import och autosparning omfattar posterna.

34 kodtester passerar. scripts/laundry.mjs verifierar placering, avbrytning, borttagning, historik och omladdning med mus och pekskärm samt att markredigering behåller linorna.
