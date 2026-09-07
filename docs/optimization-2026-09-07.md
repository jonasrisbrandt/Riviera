# Optimering 1–4: implementering och resultat

Resursfrigöring, BVH-pekning, inkrementellt byggande och återanvändning av geometri/buffertar är implementerade. Geometrigenereringen körs i en worker. Instansmatriser beräknas med WebGPU-compute när ett område ändras.

## Före och efter

Samma dator och produktionsscenarier som i [ursprungsmätningen](performance-2026-09-07.md): Ryzen AI 9 HX 370, RTX 4070 Laptop, Chrome 151, 1440 × 1000 och pixel ratio 1. Startby: 238 block. Stor by: 1 994 block. Eftermätningen omfattar 25 sekvenser, 9 227 CPU-bildrutor och 3 241 GPU-mätta bildrutor. Alla tider i ms.

| Mätning                                  |    Före p50 / p95 | Efter p50 / p95 |
| ---------------------------------------- | ----------------: | --------------: |
| Startby: geometriuppdatering             |     104,2 / 125,5 | **19,8 / 27,6** |
| Stor by: geometriuppdatering             | 1 115,7 / 1 428,7 | **25,1 / 46,4** |
| Stor by: pektest vid pekrörelse          |       46,4 / 65,5 |  **<0,1 / 0,1** |
| Stor by: CPU-bildruta vid kamerarotation |       44,5 / 73,8 |   **1,9 / 2,5** |
| Stor by: bildintervall under bygg/ångra  |    27,0 / 1 433,0 |  **9,4 / 12,0** |

Den nya geometriuppdateringen mäts från begäran tills worker-resultatet har applicerats på huvudtråden, inklusive överföring och schemaläggning. Den gamla uppdateringen var ett synkront CPU-anrop. Den nya tiden är alltså **inte bara tiden att posta ett meddelande till workern**.

Vanliga ändringar i stora byn får färdig geometri ungefär **44 gånger snabbare** i denna jämförelse. I slutet av testsekvensen byggs sex celler och ett område om, i stället för samtliga 496 celler. Startbyns motsvarande ändring berör sex celler i tre områden.

GPU-tidsstämplar och JavaScript-klockan är kvantiserade. Ett uppmätt pektest på 0 ms betyder kortare än mätupplösningen, inte att inget arbete utförs. Använd p95 och antalet prov i [mätdata](optimization-2026-09-07.json).

## Respons och arbete på olika trådar

| Efter, bygg/ångra                       | Startby p50 / p95 | Stor by p50 / p95 |
| --------------------------------------- | ----------------: | ----------------: |
| Worker-arbete                           |       18,5 / 25,1 |       22,8 / 44,3 |
| Applicera buffertdata på huvudtråden    |         0,3 / 0,5 |         0,4 / 0,6 |
| Geometri klar                           |       19,8 / 27,6 |       25,1 / 46,4 |
| Första bildruta med ändringen inskickad |       27,9 / 39,8 |       33,3 / 52,5 |

Första inskickade bildrutan inkluderar väntan till animationsloopen och CPU-arbetet för compute/render. GPU-exekvering, browser-komposition och faktisk skärmpresentation tillkommer; det är inte ett mått på input-to-photon.

Det stora sammanhängande taket omfattar 154 celler. En ändring kan påverka hela takfältet, så alla dessa celler räknas om: geometri klar 248 / 302 ms och första bildruta inskickad 256 / 314 ms. Renderingen fortsätter under worker-arbetet; bildintervallets p95 är 13,2 ms i denna sekvens.

## 1. Resurser frigörs från alla renderpass

Geometri, instansdata, compute-bindings och renderobjekt från både skugg- och världspass städas vid borttagning eller kapacitetsbyte. Det löser den tidigare kvarhållningen av attribut som bara världspasset använde, samt materialens referenser till gamla renderobjekt.

Detta är kapslat i `src/render-resources.js`. Three.js är låst till **0.185.1** eftersom anpassningen använder rendererns interna resursregister. Versionskontroll och ett stresstest ska följa med en framtida Three-uppgradering.

| Minneskontroll, profileringen avstängd                |   Registrerade renderresurser |
| ----------------------------------------------------- | ----------------------------: |
| Tidigare, efter förberedande klick och 20 ombyggnader |                   1 086,7 MiB |
| Nu, före upprepade cykler                             |                     172,5 MiB |
| Nu, efter 10 / 50 / 100 bygg–ångra-cykler             | **172,5 / 172,5 / 172,5 MiB** |
| Nu, efter GC                                          |                     172,5 MiB |
| Nu, efter att hela byn tömts                          |                  **72,3 MiB** |

100 cykler motsvarar 200 geometriuppdateringar. Attributantal och uniformbuffertantal är stabila efter uppvärmning. När byn töms återstår mindre än 1 MiB attributdata; huvuddelen av de kvarvarande 72 MiB är render-/AO-/skuggtexturer. Siffrorna är Three.js resursbokföring, inte fysisk VRAM-residens.

## 2. Exakta pektest med återanvända BVH

Varje ändrad cell får BVH för sina väggar, tak och fundament. Sökträden för oförändrade celler behålls. Ett litet överordnat träd förenar dem per område, utan att sortera om alla trianglar vid varje klick.

Pekningen testar områdenas bounds och söker närmaste framåtvända triangel. Cell, våning och väggsida behålls. Ett separat rumsligt index används för vatten-/cellsökningen och för nockpannornas höjdfrågor mot taktrianglar. Hover-test pausas under kameradrag, och markörens små buffertar återanvänds.

250 automatiska strålar jämför närmaste träff och metadata med Three.js vanliga brute-force-raycast. Testerna för sidobyggande, borttagning under broar och valvens stöd går också igenom.

## 3. Bara berörda delar byggs om

Workern behåller den föregående byn, cellgeometri och takplaner. Ändringar markerar den ändrade cellen och cellerna vid dess hörn. Om en takkomponent ändrar utbredning eller exponering räknas hela den berörda komponenten om. Detta täcker även hopsättning/delning av tak och valv som stöds diagonalt över ett hörn.

Geometrin delas i områden om **12 × 12 världsenheter**, med separata materialbatcher och instanser. Startbyn har fem aktiva områden; den stora byn har nio. Strandmasken uppdateras endast när fundamentens utbredning ändras.

Varje worker-jobb har ett versionsnummer. Föråldrade svar förkastas. Nästa svar innehåller alla områden som huvudtråden ännu inte kvitterat, så en bortkastad mellanversion inte kan lämna hål eller gamla hus kvar. Klick under ett pågående bygge köas med sin ursprungliga stråle och färg. Ångra, gör om och import hanterar versionsbytet och avbryter relevanta köade klick.

## 4. Typade buffertar, worker och WebGPU-compute

Byggreglerna har flyttats till `cell-builder.js` och `build-engine.js`. Tak, nockpannor och BVH genereras i en modulworker. Attribut skrivs direkt till typade arrayer och överförs med transferable buffers.

Huvudtrådens mesh- och instansbuffertar behåller kapacitet och uppdateras med ändrade intervall. Nya buffertar skapas först när kapaciteten inte räcker. Pekningen använder vyer in i befintliga positionsbuffertar, vilket undviker extra långlivade CPU-kopior. Buffertarna laddas inte upp på nytt under oförändrade bildrutor.

Instansposition, skala och rotation skickas kompakt till GPU:n. Ett compute-pass producerar matriserna för fönster, luckor, träd, balkonger och andra instanser före nästa renderpass. Bounds beräknas konservativt utan GPU-readback. Läsning tillbaka används enbart i verifieringstestet: över **52 000 matriser** jämförs med CPU-referensen med tolerans 0,000002.

Takets topologi och avståndsfält beräknas fortfarande i workern; takets pannmönster och relief ligger fortsatt i shadern. Den nya compute-flytten gäller instansmatriserna. Geometrin i referensscenarierna för tak, väggar och stöd är byte-identisk med versionen före optimeringarna.

## Avvägningar och kvarvarande kostnader

- Områdesindelningen ökar draw calls för hela bilden från 22 till 39 i startbyn och till 70 i den stora byn. Stor by i vila använder 1,7–1,9 ms CPU mot tidigare 1,0–1,2 ms. Det är kostnaden för mindre uppdateringar och rumslig indelning. Kamera- och byggrespons förbättras betydligt.
- GPU-passumman i stora byn i vila ligger på 1,44–1,51 ms, jämfört med tidigare 1,38–1,44 ms. AO, skuggor, vatten och materialkvalitet är bibehållna. Små skillnader påverkas även av GPU-klockor och bakgrundsarbete.
- Den första fulla importen av den stora byn tar fortfarande cirka 1,74 s till applicerad geometri i denna körning. Det nya BVH-underlaget ingår i arbetet. Första bildrutan med alla nya GPU-resurser tog ytterligare cirka 211 ms CPU; kall pipeline-/GPU-uppsättning behöver fortfarande förbättras. Vanliga upprepade ändringar återanvänder dessa resurser.

## Verifiering och reproduktion

- 22 enhetstester: bland annat referensgeometri, inkrementellt kontra färskt fullbygge, BVH kontra brute force, komponentändringar, stöd och ej kvitterade områden.
- Befintliga 17 interaktionskontroller, större by, tak-/valvkontroller samt vatten-/takbilder från 19 kameravarianter.
- GPU-matriskontroll, 100 bygg/ångra-cykler och full resursfrigöring när byn töms.
- Riktiga snabba klick med avsiktligt fördröjda worker-svar: inga tappade mål, korrekt ordning och ångring av köade ändringar.
- Produktionsbygge och WebGPU utan fångade JavaScript-/GPU-fel.

Kör `npm run build`, starta `npm run preview -- --port 4173`, och kör därefter `npm run profile`, `npm run test:optimized` och `node scripts/worker-input.mjs`. F3 visar mätpanelen. `window.riviera.ready()` väntar på senast begärda geometri. [Alla eftermätningar och minneskontroller](optimization-2026-09-07.json) finns sparade tillsammans med denna rapport.
