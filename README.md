# Riviera

En spelbar, Townscaper-inspirerad byggleksak med Cinque Terre-färger, terrakottatak, fönsterluckor, balkonger och skulpterbara kustlandskap. All geometri skapas i projektet; inga tillgångar från originalspelet används.

**[Spela Riviera](https://jonasrisbrandt.github.io/Riviera/)** · [Källkod](https://github.com/jonasrisbrandt/Riviera)

## Starta

Använd Node.js 24 eller senare.

```sh
npm install
npm run dev
```

Öppna adressen som Vite skriver ut. Kräver en webbläsare med fungerande **WebGPU**, exempelvis Chrome eller Edge med hårdvaruacceleration. Appen kontrollerar att WebGPU-backend faktiskt används och accepterar inte en tyst WebGL-fallback. WebGPU kräver localhost eller HTTPS.

## Bygga

- Klicka på vatten för en kaj. Klicka igen för ett hus.
- Klicka på tak för fler våningar, på väggar för att bygga åt sidan.
- Välj en färg i paletten. Den randiga knappen bygger kajer.
- Högerklick eller suddgummi tar bort ett block. Övre våningar kan lämnas kvar som broar. Valv skapas där båda benen har stöd; korta konsoler bär utsprång mot en intilliggande vägg.
- Dra för att rotera, skrolla för att zooma, Shift + dra eller mittknapp för att panorera.
- På pekskärm: tryck för att bygga, dra för att rotera, nyp för att zooma och använd suddgummi för att ta bort.
- B/E väljer byggverktyg/suddgummi. H centrerar kameran. Ctrl/Cmd+Z ångrar, Ctrl/Cmd+Shift+Z gör om.
- Solknappen öppnar ljus, skuggor, AO, kvalitet, rutnät, export/import och nytt hav. Nytt hav kan ångras.
- Kameraknappen sparar en PNG utan gränssnitt. Ljudknappen aktiverar syntetiskt havsljud och byggljud.

Byn autosparas lokalt. Exportera JSON för en flyttbar säkerhetskopia.

## Forma landskap

- Välj bergsknappen **Landskap** eller tryck **L**. **B** återgår till byggnader.
- Klicka eller dra med musen för att höja mark, en nivå per cell och penseldrag. Högerklick eller **Sänk** sänker; mark kan återgå till vatten.
- **Auto** väljer gröna platåer, klippor, strandsluttningar och murar nära bebyggelse. Gräs, Klippa, Torr jord och Sand kan väljas explicit.
- **Måla** ändrar materialet utan att ändra höjd. **Jämna** flyttar marken ett steg mot grannarnas medelhöjd.
- Hus byggs direkt på land och följer med när marken höjs eller sänks. Tak och väggar ansluter utifrån faktisk världshöjd.
- Lämpliga passager mellan terrasser får automatiska stentrappor. Vegetation och kuststenar genereras deterministiskt.
- Ett penseldrag är en enda ångra-operation. Alt + dra roterar kameran i landskapsläge; Shift + dra panorerar. På mobil: tryck för att forma, två fingrar för kameran.
- Nya besökare får en landskapsby. Befintliga sparningar bevaras. **Inställningar → Upptäck en landskapsby** öppnar exemplet; Ångra återställer din föregående by.

Sparformat 2 lägger till markhöjd och material; äldre byar i format 1 fungerar fortsatt. Landskapet har högst 12 nivåer; markhöjd plus husvåningar ryms inom 24 nivåer.

Se [landskapets arkitektur, verifiering och mätning](docs/landscape.md).

## GitHub Pages

Push till `main` kör testerna, bygger projektet och publicerar `dist/` genom `.github/workflows/pages.yml`. GitHub Pages använder källan **GitHub Actions**. Produktionsbygget har basvägen `/Riviera/`; utvecklingsservern fungerar fortfarande på `/`.

Kör `npm run build` och `npm run preview` för att testa produktionsversionen lokalt på `http://localhost:4173/Riviera/`. Webbläsartestet kan köras mot denna adress eller den publicerade sidan genom miljövariabeln `RIVIERA_URL`.

Lokala sparningar hör till webbadressen. För att flytta en by från localhost till GitHub Pages: exportera JSON lokalt och importera filen på den publicerade sidan.

## Teknik

- Three.js `WebGPURenderer`, TSL-shaders som kompileras till WGSL, MRT och MSAA.
- Delaunay-triangulering, matchning av trianglar, uppdelning till fyrhörningar och avslappning ger ett sammanhängande oregelbundet rutnät med varierande vertexvalens.
- Grannregler tar bort interna väggar, kopplar ihop tak och skapar kajkanter, valv, planteringar och detaljer.
- Sammanhängande tak på samma höjd delar ett gemensamt avståndsfält, mjuka takfall och rundade nockpannor. Pannornas rader, färgvariation och relief beräknas i GPU-shadern.
- Inkrementella områden om 12 × 12 världsenheter, med materialbatcher och GPU-instansiering. Startbyn har fem aktiva områden. Oförändrade geometrier, instansbuffertar och sökträd återanvänds. Instansmatriser genereras med WebGPU-compute enbart när ett område ändras.
- Vattenrörelser, skum, puts-/tegelmönster, fåglar och bygganimationer körs i GPU-shaders.
- Ground Truth Ambient Occlusion (GTAO) i halv upplösning, kantmedveten brusreducering, PCF-solskuggor och filmisk tonmappning. Skuggkartan uppdateras vid byggande, bygganimation och ändrat solljus.
- En worker hanterar byggregler, takgeometri, typade attributbuffertar och BVH. Ändrade celler, hörngrannar och påverkade takkomponenter byggs om. Main thread sköter inmatning, BVH-träfftestning och applicering av överförda områden; den väntar inte på geometrigenereringen. Föråldrade workersvar förkastas och senare svar innehåller alla ej kvitterade områden.
- BufferGeometry och instansbuffertar växer vid behov och återanvänds. Resurser från samtliga renderpass frigörs vid borttagning. Three.js är låst till 0.185.1; kompatibilitetslagret i render-resources.js behöver verifieras vid versionsbyte.

Rutnätet är ändligt (ungefär 74 enheter i diameter) och höjden begränsad till 24 husvåningar. Det är en egen tolkning av byggsystemet; originalets fullständiga regelbibliotek och alla dess specialformer är inte återskapade.

## Kontrollera

```sh
npm test
npm run build
node scripts/interaction.mjs
node scripts/roof-supports.mjs
node scripts/advanced.mjs
node scripts/surface-artifacts.mjs
npm run test:optimized
node scripts/build-frames.mjs
node scripts/landscape.mjs
node scripts/landscape-performance.mjs
```

Webbläsartestet kräver lokal Chrome, en körande Vite-server på port 5173 och tillåtelse att starta en isolerad webbläsarprocess. Det testar WebGPU, klickbyggande, färgval, borttagning, historik, autosparning, import/export och PNG. Bilder och rapporter skrivs till `artifacts/`.

`scripts/build-frames.mjs` körs mot Vite-utvecklingsservern. Det fångar WebGPU-bilden efter varje renderad ruta under byggande, rivning och ångra/gör om, även med 200 ms fördröjda workersvar. Oförändrade hus jämförs pixelvis för att upptäcka tillfälliga färg- eller geometriblinkningar. Teståtkomsten injiceras endast i den isolerade webbläsaren.

`window.riviera.stats` ger läsbar diagnostik över backend, FPS, celler, block och instanser. FPS-resultat beror på GPU, fönsterstorlek och kvalitetsval.

## Referenser

- [Townscaper, Oskar Stålberg](https://oskarstalberg.com/Townscaper/)
- [Vernazza, Italia.it](https://www.italia.it/en/liguria/la-spezia/vernazza)
- [Three.js WebGPU](https://threejs.org/manual/en/webgpurenderer)
- [Three.js WebGPU postprocessing](https://threejs.org/manual/en/webgpu-postprocessing.html)

## Prestandamätning

Tryck **F3** för mätpanelen. Ny mätning nollställer statistiken; Stoppa avslutar insamlingen; Spara JSON exporterar samtliga mätserier. F3 döljer panelen utan att stoppa en pågående mätning. Lägg till `?profile` i URL:en för att även mäta uppstarten. Vanlig start har profileringen avstängd.

CPU-tider visar både inklusive tid (`cpu.*`) och egen tid utan underanrop (`self.*`). GPU-tider kommer från WebGPU-tidsstämplar för verkliga render-/compute-pass, med asynkron avläsning var tredje bildruta samt vid geometriändringar. Enheter utan `timestamp-query` får CPU-mätning och en tydlig upplysning om saknade GPU-tider. Slutpasset innehåller även AO-brusreduceringen. Små tider kan avrundas till noll av webbläsaren.

Reproducerbar mätning med isolerad Chrome och produktionsbygget:

```sh
npm run build
npm run preview -- --port 4173
# I en annan terminal:
npm run profile
node scripts/profile-validation.mjs
```

`RIVIERA_URL` kan ange en annan server som innehåller mätkoden. Skripten använder egna webbläsarprofiler och ändrar inte din sparade by. Rådata och kontrollmätningar sparas i `artifacts/performance.json` respektive `artifacts/performance-controls.json`. De omfattar startby, större by, sammanhängande tak, pekrörelser, kamera, bygg/ångra, AO, upplösning och minneskontroll med profileringen avstängd.

Se [resultat efter optimering 1–4](docs/optimization-2026-09-07.md) och [den ursprungliga genomgången](docs/performance-2026-09-07.md). Anropa await window.riviera.ready() för att vänta på den senaste geometriversionen i automatiska kontroller. Mätpanelen skiljer huvudtrådens tillämpning, worker-tid och bygglatens; async.build.firstFrameSubmitted mäter till första inskickade bildrutan, exklusive skärmens presentation. Diagnostik-API: `window.riviera.profiling.start(label, { gpuEvery: 3 })`, `snapshot()` och `await stop()`. `experiment({ aoMode: "raw" | "off" | "full", pixelRatio: 1 })` är enbart för isolerade jämförelser; ladda om sidan för att återställa alla bildinställningar efter egna experiment.
