# Landskap i Riviera

Landskapet använder samma oregelbundna celler som husen. Höjd och material lagras separat från husvåningarna så att marken kan ändras utan att bebyggelsen försvinner.

## Funktion och gränser

- Byggnader/Landskap, höj/sänk, materialmålning och utjämning ett steg mot grannarnas medelhöjd.
- Auto, Gräs, Klippa, Torr jord och Sand. Auto genererar gröna platåer, kustklippor, sandkanter och stödmurar nära hus.
- Stentrappor uppstår i obebyggda celler mellan lämpliga nivåer. Öppningen klipps ur markytan och kontrolleras mot cellens form.
- Vegetation, kuststenar och en redigerbar exempelby ingår. Befintliga sparningar ersätts inte vid uppdatering.
- Penseldrag grupperas till en ångra-operation. Pekskärm använder tryck för skulptering och två fingrar för kamera.
- Hus följer marken vertikalt. Takgrupper och dolda väggar beräknas vid gemensam absolut höjd.
- Högst 12 marknivåer; mark plus hus ryms inom 24 nivåer.
- Grottor, naturliga stenbågar, vingårdar och ett manuellt system för stigar ingår inte i denna version, enligt specens föreslagna avgränsning. Utjämningen ändrar cellhöjder; den är inte en kontinuerlig höjdfältspensel.

## Data och rendering

`state.js` läser format 1 och 2. Format 2 innehåller `terrain: [[cellId, [height, material]], ...]`. Hela byn, inklusive marken, ingår i historik, autosparning och JSON-export.

`BuildEngine` gör granninvalidiering för både hus- och markändringar. Land, murar och dekorationer cachas per cell och överförs endast för ändrade områden. Husgeometrin genereras i lokala våningar och förskjuts med markhöjden; träffmetadata och bygganimationer behåller lokala våningsnummer.

En extra markbatch per aktivt område renderas med WebGPU. Vegetation och trappsteg använder samma återanvända instansbuffertar och GPU-compute för matriser som resten av byn. Skuggor och AO använder markens riktiga geometri och djup. Gemensamma, styckvis linjära kantprofiler håller klippor, murar och marklock samman. Kustmasken uppdateras först när geometrin accepteras.

## Verifiering

- 28 kodtester, inklusive äldre byars byte-identiska geometri, sparformat, inkrementellt/färskt resultat, tak på olika markhöjd och öppna trapphål.
- 17 befintliga WebGPU-interaktionskontroller passerar.
- 7 landskapsflöden passerar i produktionsbygget, även med 200 ms fördröjda workersvar: höj/sänk under hus, material, historik, drag, autosparning, export/import och mobil.
- 12 bildruteregessioner passerar med noll ändrade kontrollpixlar på oförändrade hus. Den tidigare instansfärgsblinkningen återkommer inte.
- 30 ångra/gör om-cykler per mätby (120 ombyggen totalt), korrekt GPU-matrisinnehåll och frigjorda världsbufferar efter radering.

## Mätning

Isolerad Chrome 151 på Windows, NVIDIA Lovelace-adapter, 1440 × 1000, pixelkvot 1, AO och skuggor aktiva. Värdena är medelvärden i ms; GPU anger summan av uppmätta render-/compute-pass, inte presentation eller köväntan.

| Scenario | CPU/bildruta | GPU-pass/bildruta | Geometrilatens | GPU-resurser |
| --- | ---: | ---: | ---: | ---: |
| Exempelby, stilla | 1,67 | 1,05 | – | 84,5 MiB |
| Exempelby, markändringar | 2,09 | 1,12 | 18,27 | 84,5 MiB |
| 496 markceller, stilla | 1,83 | 1,25 | – | 101,6 MiB |
| 496 markceller, markändringar | 2,19 | 1,31 | 12,07 | 101,6 MiB |

Exempelbyn har 143 markceller och 91 husvåningar. Den stora mätbyn har 496 markceller, 288 husvåningar och cirka 26 000 instanser. Latens varierar med vilka takgrupper och grannar som påverkas; den mindre byn har därför inte alltid lägre bygglatens. Minnet var oförändrat mellan provpunkterna efter 6, 16 och 30 cykler.

Kör `node scripts/landscape.mjs` mot Vite eller produktionspreview. `WORKER_DELAY=200` simulerar långsamma workersvar. `node scripts/landscape-performance.mjs` använder produktionspreview på port 4173 och skriver rådata till `artifacts/landscape-performance.json`. `RIVIERA_URL` kan ange en annan lokal server.
