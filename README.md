# Riviera

En spelbar, Townscaper-inspirerad byggleksak med Cinque Terre-färger, terrakottatak, fönsterluckor, balkonger och en liten hamn. All geometri skapas i projektet; inga tillgångar från originalspelet används.

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

## GitHub Pages

Push till `main` kör testerna, bygger projektet och publicerar `dist/` genom `.github/workflows/pages.yml`. GitHub Pages använder källan **GitHub Actions**. Produktionsbygget har basvägen `/Riviera/`; utvecklingsservern fungerar fortfarande på `/`.

Kör `npm run build` och `npm run preview` för att testa produktionsversionen lokalt på `http://localhost:4173/Riviera/`. Webbläsartestet kan köras mot denna adress eller den publicerade sidan genom miljövariabeln `RIVIERA_URL`.

Lokala sparningar hör till webbadressen. För att flytta en by från localhost till GitHub Pages: exportera JSON lokalt och importera filen på den publicerade sidan.

## Teknik

- Three.js `WebGPURenderer`, TSL-shaders som kompileras till WGSL, MRT och MSAA.
- Delaunay-triangulering, matchning av trianglar, uppdelning till fyrhörningar och avslappning ger ett sammanhängande oregelbundet rutnät med varierande vertexvalens.
- Grannregler tar bort interna väggar, kopplar ihop tak och skapar kajkanter, valv, planteringar och detaljer.
- Sammanhängande tak på samma höjd delar ett gemensamt avståndsfält, mjuka takfall och rundade nockpannor. Pannornas rader, färgvariation och relief beräknas i GPU-shadern.
- Tre sammanslagna geometrier för puts, tak och sten; GPU-instansiering för fönster, fönsterluckor, balkonger, träd och övriga detaljer. Startbyn använder sex geometriritningar för dessa kategorier, utöver vatten, båtar, fåglar och efterbehandling.
- Vattenrörelser, skum, puts-/tegelmönster, fåglar och bygganimationer körs i GPU-shaders.
- Ground Truth Ambient Occlusion (GTAO) i halv upplösning, kantmedveten brusreducering, PCF-solskuggor och filmisk tonmappning. Skuggkartan uppdateras vid byggande, bygganimation och ändrat solljus.
- CPU:n hanterar inmatning, träfftestning, sparning och geometriändringar vid byggande. Inget nät byggs om i den vanliga renderloopen.

Rutnätet är ändligt (ungefär 74 enheter i diameter) och höjden begränsad till 24 husvåningar. Det är en egen tolkning av byggsystemet; originalets fullständiga regelbibliotek och alla dess specialformer är inte återskapade.

## Kontrollera

```sh
npm test
npm run build
node scripts/interaction.mjs
node scripts/roof-supports.mjs
node scripts/advanced.mjs
node scripts/surface-artifacts.mjs
```

Webbläsartestet kräver lokal Chrome, en körande Vite-server på port 5173 och tillåtelse att starta en isolerad webbläsarprocess. Det testar WebGPU, klickbyggande, färgval, borttagning, historik, autosparning, import/export och PNG. Bilder och rapporter skrivs till `artifacts/`.

`window.riviera.stats` ger läsbar diagnostik över backend, FPS, celler, block och instanser. FPS-resultat beror på GPU, fönsterstorlek och kvalitetsval.

## Referenser

- [Townscaper, Oskar Stålberg](https://oskarstalberg.com/Townscaper/)
- [Vernazza, Italia.it](https://www.italia.it/en/liguria/la-spezia/vernazza)
- [Three.js WebGPU](https://threejs.org/manual/en/webgpurenderer)
- [Three.js WebGPU postprocessing](https://threejs.org/manual/en/webgpu-postprocessing.html)
