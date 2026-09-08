# Sammanhängande sluttningar

Sluttningar använder fortfarande sparformatets `[höjd, material, låg kant]`. Äldre byar får den nya ytan när de öppnas; ingen migrering behövs.

`cornerHeights(cell, terrain, town, cells)` i `src/terrain.js` löser höjder runt varje gemensamt rutnätshörn. Angränsande sluttningar och deras plana skuldror får gemensamma höjder där deras tillåtna höjdintervall överlappar. Hus och kajer förankrar hörnen till sin plana grundhöjd. Separata terrasser behåller klippsidor när en sluttning inte kan binda ihop dem.

`src/terrain-surface.js` beskriver en mjuk kubisk profil med åtta segment per riktning. Ovansida, sidoytor och redigeringskontur använder samma kantprov. Dekorationer samplas mot de faktiska trianglarna, så deras bas inte hamnar på cellens nominella övre höjd.

Gräsmark får jordstråk och små färgskiftningar i världskoordinater. Sluttningar får buskkluster och stenar samt de befintliga trädtyperna. Variationen är deterministisk och detaljerna använder befintliga GPU-instansbatcher. Höjdplanering och triangulering körs i workern vid ändringar.

Kontroller:

- `npm test`: anslutningar både längs och tvärs över backar, motsatta lutningar, plana husgrunder, täta pickbara ytor och inkrementell geometri jämförd med fullständig ombyggnad.
- `node scripts/coastal-features.mjs`: sluttning via gränssnittet, ångra/gör om, husplacering och picking av hål.
- `node scripts/slopes.mjs`: en separat testby med 44 sluttningar; skärmbilder från flera kameravinklar i `artifacts/`. Körs mot Vite eller `RIVIERA_URL`.

Att forma en sluttning kan även justera hörnen på öppen mark bredvid den. Byggnadernas fundament flyttas inte av denna anpassning. Verktyget behåller sin regel om en lägre landgranne inom ett eller två halvsteg.
