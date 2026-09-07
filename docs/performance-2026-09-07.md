# Riviera: prestandagenomgång 2026-09-07

De största problemen finns i CPU-arbetet vid byggande och pektest, samt i resursfrigöringen efter en ombyggnad. GPU:n har gott om utrymme på testdatorn vid normal upplösning. AO och brusreducering står för en stor del av GPU-kostnaden i startbyn.

Instrumentering, mätpanel och reproducerbara tester är implementerade. Optimeringarna nedan är förslag; bildkvalitet och byggregler har inte ändrats.

## Metod och omfattning

- Produktionsbygge av `587526c` plus den lokala instrumenteringen, Vite 8.2.2 / Three.js 0.185.1.
- Windows, AMD Ryzen AI 9 HX 370, NVIDIA GeForce RTX 4070 Laptop GPU, drivrutin 32.0.15.9174. WebGPU-adaptern rapporterar NVIDIA/Lovelace.
- Chrome 151 i isolerat headless-läge, hårdvaru-WebGPU utan särskilda WebGPU-flaggor. 1440 × 1000 CSS-pixlar, faktisk pixel ratio 1 om inget annat anges. AO och skuggor på. Startkameran återställs mellan scenarier.
- 25 mätsekvenser, **7 428 CPU-bildrutor och 2 575 GPU-mätta bildrutor**. Tre separata 3-sekunderssekvenser för vardera by i vila. Övriga GPU-jämförelser är en sekvens per variant efter uppvärmning.
- Byggtesterna gör tio riktiga byggklick och tio ångringar, kontrollerar att varje klick lägger till exakt ett block och att ångring återställer identisk by. Varje sekvens innehåller alltså 20 ombyggnader.
- Separat kontroll av minnesutveckling med profileringen avstängd, samt växlande kontroll av profileringskostnad. Testerna använder egna sparningar och påverkar inte användarens by.

Alla tider nedan är millisekunder. **p50 är median; p95 visar den långsammare svansen.** Intervall för vila visar variationen mellan de tre sekvenserna, inte konfidensintervall. GPU-klockfrekvens, bakgrundsarbete och headless-schemaläggning kan påverka resultaten. Detta är en mätning på en dator, inte en garanti för integrerade GPU:er eller mobiler.

Data: [samtliga mätserier och kontroller](performance-2026-09-07.json). Oavrundade lokala rårapporter finns i `artifacts/performance.json` och `artifacts/performance-controls.json`. JSON-statistiken innehåller antal prov, medelvärde, p50, p95, max och total per del.

## Vad som mäts

| Område           | Mätning                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uppstart         | WebGPU-initiering som asynkron väggtid; grid, startby, material/miljö och scenbygge som CPU-tid                                                               |
| Byggande         | Hela ombyggnaden, disposal, takplanering, tessellering, nockpannor, fundament, fasader, valv/stöd, gatudetaljer, buffertar per material, instanser och bounds |
| Inmatning        | Träfftest mot geometri, cellsökning, hover-geometri, redigering, kamera och historik                                                                          |
| Övrig CPU        | Båtrörelser, animationsuniformer, serialisering, localStorage, filimport, nedladdning, ljuduppsättning, ljus-/AO-inställningar och UI-arbete i ombyggnaden    |
| Render-CPU       | Three.js renderanrop och egen tid; WebGPU-API-anrop för buffertar, texturer, shader/pipeline-skapande, överföringar och submit                                |
| GPU              | Verkliga timestamp queries runt varje render-/compute-pass: värld, skuggor, AO, editor och slutbild; även extra pass klassificeras om de körs                 |
| Asynkront arbete | Pipeline-kompilering, filinläsning, PNG-kodning och timestamp-avläsning som väggtid, separat från CPU-tid                                                     |
| Resurser         | Rendererns draw calls, trianglar, allokeringsstatistik samt antal och byte för `queue.writeBuffer`                                                            |

CPU-spannen är nästlade: `cpu.*` inkluderar underanrop och `self.*` drar bort dessa. Summera inte inkluderande CPU-rader. Små per-cell-anrop kan avrundas till noll; totalen över många anrop är mer användbar.

GPU-tiderna är exekveringstid, **inte tiden som JavaScript använder för `submit()`**. Sex återanvända query/readback-platser möjliggör asynkron avläsning var tredje bildruta. Ingen väntan på GPU:n läggs i renderloopen. Inga tappade mätbildrutor, query-overflows eller GPU-valideringsfel noterades.

`gpu.passSum` summerar passens exekvering och utesluter kopior och mellanrum. `gpu.span` omfattar tiden från första passets början till sista passets slut, inklusive mellanrum; den är inte en ren GPU-arbetstid. Tidsstämplarna är kvantiserade, här ofta i steg om cirka 0,066 ms. Ett pass med 0 ms är därför inte gratis.

Vatten, hus och materialeffekter delar världspass. AO-brusreducering, komposition och tonmappning delar slutshader. Dessa shaderdelar får inte påhittade separata GPU-tider; deras påverkan undersöks genom variantjämförelser. Kopieringsarbete, browser-kompositor, presentation och ljudets DSP-tråd har inte egna GPU-tidsstämplar. `writeBuffer`-byte är API-volym och inkluderar inte initiala uppladdningar via mapped-at-creation-buffertar. Shaderkompileringens interna drivrutinsarbete kan inte delas upp med dessa verktyg.

## Rendering och interaktion

Startbyn har 87 celler, 238 block, 151 husvåningar och 5 430 instanser. Den stora byn har 496 celler, 1 994 block, 1 498 husvåningar och 52 111 instanser. Ett tredje fall har 154 celler och ett stort sammanhängande tak.

| Scenario                     | CPU bildruta p50 / p95 | GPU passumma p50 / p95 |
| ---------------------------- | ---------------------: | ---------------------: |
| Startby, vila, tre sekvenser |      1,0–1,1 / 1,6–1,8 |  1,05–1,38 / 1,25–1,57 |
| Stor by, vila, tre sekvenser |      1,0–1,2 / 1,6–1,7 |  1,38–1,44 / 1,64–1,77 |
| Startby, rotera kamera       |              4,8 / 9,1 |            1,51 / 1,97 |
| Stor by, rotera kamera       |        **44,5 / 73,8** |            1,90 / 7,47 |
| Startby, pekrörelse          |              1,3 / 7,0 |            1,51 / 1,57 |
| Stor by, pekrörelse          |             1,8 / 64,9 |            1,64 / 2,16 |

I pekrörelsetestet innehåller bara vissa bildrutor ett nytt pektest. Därför kan bildrutans median vara låg samtidigt som varje utfört pektest är dyrt. Under kamerarotation markeras hover som ändrad även när pekaren ligger stilla, så problemet träffar betydligt fler bildrutor.

| Arbete                                                      | Startby p50 / p95 |     Stor by p50 / p95 |
| ----------------------------------------------------------- | ----------------: | --------------------: |
| Ett raycast-anrop under pekrörelse                          |         3,6 / 5,9 |       **46,4 / 65,5** |
| En komplett ombyggnad, bygg/ångra                           | **104,2 / 125,5** | **1 115,7 / 1 428,7** |
| Byggklickets CPU-hantering, inklusive pektest och ombyggnad |     104,9 / 129,5 |     1 214,8 / 1 423,3 |

Det sammanhängande takets ombyggnad tar 280,9 / 354,6 ms. Import av den stora byn tar 1 121,7 ms i själva ombyggnaden. Ett nytt litet block utlöser i dag full ombyggnad av hela byn.

Byggarbetet ligger i pekhändelsen utanför animationsloopen. Därför är `cpu.frame` ensamt ett missvisande mått på byggrespons. I stora byns byggtest når bildintervallets p95 **1 433 ms**. Under rotation är medianintervallet 45,4 ms, ungefär 22 bildrutor/s, trots att GPU-passen vanligtvis tar under 2 ms.

I vila används 22 draw calls för hela bilden. Byns sex geometrikategorier är alltså inte samma sak som sex draw calls totalt. Stora byn ritar cirka 1,12 miljoner trianglar i vila; skuggkartans uppdatering kan ungefär fördubbla geometriritningen. Antalet draw calls växer däremot inte med varje fönster, tack vare instansiering.

## Var byggtiden går

Följande är **genomsnittlig tid per full ombyggnad**, beräknad från totalsummor över 20 ombyggnader. Raderna för takdelar använder egen tid och överlappar inte.

| Del                                                         | Startby | Stor by |
| ----------------------------------------------------------- | ------: | ------: |
| Tessellering av tak                                         |    33,4 |   303,6 |
| Nockpannor, egen tid                                        |    17,6 |   197,4 |
| Övrigt takbygge: trianglar, attribut, kanter och skorstenar |    38,2 |   474,2 |
| Takets slutliga BufferGeometry                              |     7,3 |    89,0 |
| Fasader                                                     |     1,7 |    16,5 |
| Instansbygge inklusive bounds                               |     3,8 |    33,6 |
| Strandmask                                                  |     0,3 |     0,9 |

Själva takgeometrin står för cirka **84–86 % av den totala ombyggnadstiden**; takbuffertarna tillför ytterligare cirka 7–8 %. Att bara optimera draw calls eller vatten löser därför inte byggpausen. Serialisering och strandmask är små poster i dessa fall.

Uppstartens enstaka mätning gav 450 ms väggtid för WebGPU-initiering, 27 ms för gridet och 147 ms för första ombyggnaden. Det är inte en fullständig nätverks-/first-paint-mätning och ska inte jämföras direkt med uppvärmda byggklick.

## GPU-jämförelser

| Startby, stilla kamera       | GPU passumma p50 / p95 |
| ---------------------------- | ---------------------: |
| Normal bild, pixel ratio 1   |  1,05–1,38 / 1,25–1,57 |
| AO helt bortkopplad          |            0,46 / 0,59 |
| AO utan brusreducering       |            1,05 / 1,18 |
| Normal bild, pixel ratio 1,5 |            2,10 / 3,15 |
| Normal bild, pixel ratio 2   |            5,18 / 8,59 |
| Hus dolda, övrig bild kvar   |            0,92 / 1,05 |

I normala startbyn tar världspasset cirka 0,26–0,33 ms, AO 0,46–0,66 ms och slutpasset 0,33–0,46 ms. När brusreduceringen kopplas bort går slutpasset ned till omkring 0,07 ms. Solskuggans uppdatering tar omkring 0,07 ms i startbyn och 0,66 ms i median under stora byns byggande.

Varianterna visar riktning, inte exakta additiva delkostnader: GPU-klockor varierar, och att dölja hus ändrar även djupbilden som AO arbetar med. AO av är en diagnostisk jämförelse, inte ett förslag att ta bort önskad AO. Upplösningsökningen har en tydlig kostnad och bör följas särskilt på svagare GPU:er.

## Minnestillväxt: separat kontroll med profileringen avstängd

| Kontrollpunkt                                            | Registrerade renderresurser | Attributbuffertar |
| -------------------------------------------------------- | --------------------------: | ----------------: |
| Stor by före ändring                                     |                   169,9 MiB |          97,5 MiB |
| Förberedande byggklick + 10 ombyggnader via ångra/gör om |                   650,2 MiB |         576,6 MiB |
| Samma by + ytterligare 10 ombyggnader                    |             **1 086,7 MiB** |   **1 012,2 MiB** |
| Efter explicit JavaScript-GC och väntan                  |             **1 086,7 MiB** |   **1 012,2 MiB** |

De två senare byggkontrollpunkterna har exakt samma by. Tillväxten mellan dem är ungefär **43,6 MiB per ombyggnad**. Antalet registrerade attribut ökar från 193 till 293. JavaScript-heapen minskar efter GC, men rendererns registrerade resurser ligger kvar. GPU-profileringspoolen var aldrig aktiverad i denna kontroll.

Detta är en tydlig resursläcka eller kvarhållning som bör prioriteras. Siffrorna är Three.js allokeringsbokföring, inte en direkt mätning av fysisk VRAM-residens.

En konkret misstanke från kodgranskningen: Three.js `Geometries.initGeometry()` binder disposal till det renderobjekt som först använder geometrin och tar dess `getAttributes()` vid frigöring. Skuggpasset och världspasset använder olika attributmängder. Det kan lämna senare använda UV-, normal- och färgattribut kvar. Detta är en hypotes om mekanismen; den bör bekräftas per attribut innan en fix väljs. Även renderobjektens bindings och shaderresurser behöver granskas.

## Rekommenderad ordning

1. **Rätta resurslivslängden.** Följ skapande/frigöring av samtliga attribut och bindings i världs- och skuggpass, och återanvänd buffertar där det går. Verifiera med samma by efter 100 bygg/ångra-cykler; allokeringsnivån ska plana ut efter uppvärmning. Detta är viktigare än små shaderbesparingar för långa byggsessioner.

2. **Gör pektestet rumsligt avgränsat.** Använd cell-/chunk-index och enkla byggvolymer som första urval, följt av exakt tak-/väggtest bara i kandidaterna, eller en BVH över relevanta trianglar. Bevara metadata för rätt cell, våning och väggsida. Undvik kompletta hover-test under kameradrag när ingen byggmarkör behövs. GPU-picking via ID-buffer är ett alternativ, men kräver asynkron avläsning och en strategi för klicklatens; CPU-index är ett enklare första steg. Mål att verifiera: pektestets p95 under 2 ms i den stora byn.

3. **Bygg om endast berörda områden.** Behåll takplaner och geometri över redigeringar. Markera ändrad cell, relevanta grannar och berörda sammanhängande takkomponenter som ändrade. Dela rendering i stabila chunks med återanvända instans- och attributbuffertar. Ett hopkopplat eller delat tak kan påverka hela komponenten, så det räcker inte alltid med fyra grannar. Uppdatera strandmask endast när mark/fundament ändras. Detta angriper den största byggkostnaden och minskar nya allokeringar.

4. **Effektivisera takbygget och flytta tung generering från huvudtråden.** `Batch.tri()` bygger många kortlivade arrayer, använder `flat()` och omvandlar sedan växande JS-arrayer till Float32Array. Skriv direkt i återanvända typade arrayer. Ge `surfaceHeight()` ett rumsligt index till rätt taktrianglar för nockpannorna. Använd en worker för stora importer/komponentändringar med överförbara buffertar och versionsnummer som förkastar föråldrade jobb. WebGPU-compute för takfält, vertexhöjder och normaler är ett senare naturligt steg: håll grov topologi/byggmetadata på CPU och undvik att läsa tillbaka hela GPU-geometrin för pektest. Behåll geometriunderlaget som nockpannorna följer, så att de tidigare flygande kanterna inte återkommer.

5. **Optimera AO och upplösning med bildjämförelser.** Prova färre brusreduceringsprov, lägre intern upplösning med djup-/normalstyrd uppskalning och en adaptiv pixelbudget. Behåll skuggor och AO. Kontrollera tunna räcken, takkanter, valv och vatten från de tidigare problemvinklarna. Detta är främst viktigt för hög pixel ratio och svagare GPU:er.

Fler draw-call-sammanslagningar, omskrivning av vattnet och en full GPU-port av alla byggregler har lägre prioritet utifrån dessa mätningar. Typiskt lokalt byggarbete bör sikta på en huvudtrådspaus under en bildbudget; stora sammanhängande takändringar kan behöva köras asynkront med den gamla bilden kvar tills ersättningen är klar. Det är mål för nästa optimeringssteg, inte redan uppnådda vinster.

## Mätkodens påverkan och verifiering

Mätpanelen är dold under testet och statistiklagringen är begränsad till 6 000 värden per serie. Antal, medelvärde och total gäller hela sekvensen; percentiler använder kvarvarande prover. GPU-avläsningens encode/submit-kostnad redovisas separat och dess submit räknas inte som spelets submit.

Kontrollen med GPU-prov varje bildruta gav CPU-median 1,5 ms; kontrollen med bara första GPU-bildrutan gav också 1,5 ms. Separata ångra/gör om-par med profiler av/på varierade mer mellan omgångar än mellan lägena: av-medianerna 312–371 ms, på-medianerna 324–329 ms. Det räcker inte för att hävda noll overhead eller en exakt procent. Därför är profileringen avstängd vid vanlig start och tiderna bör följas med samma mätinställningar efter en optimering.

Verifierat: 17 enhetstester, produktionsbygge, 17 befintliga interaktionskontroller samt mätpanel, JSON-export, GPU-queryhantering och start med profileringen avstängd. Inga fångade JavaScript- eller GPU-fel i mätningarna. F3 visar panelen; `?profile` samlar även uppstart. Se [README](../README.md#prestandamätning) för körkommandon.
