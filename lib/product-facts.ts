/** Derives display facts (viscosity grade, series, volume) from a product name. Pure and safe for the client. */
export type ProductFacts = {
  title: string;
  grade: string | null;
  series: string | null;
  volume: string | null;
};
const seriesNames: [RegExp, string][] = [
  [/\bHPS\b/i, "HPS – High Performance Street"],
  [/\bXPR\b/i, "XPR – Extreme Performance Racing"],
  [/\bMax[- ]?Cycle\b/i, "Max-Cycle – motocykle"],
  [/\bMax[- ]?Gear\b/i, "Max Gear – przekładnie"],
  [/\bMax[- ]?ATF\b/i, "Max ATF – automatyczne skrzynie"],
  [/\bSynchromax\b/i, "Synchromax – manualne skrzynie"],
  [/\bDuralec\b/i, "Duralec – silniki Diesla"],
  [/\bBreak[- ]?In\b/i, "Break-In – docieranie silnika"],
  [/\bPurple Ice\b/i, "Purple Ice – układ chłodzenia"],
  [/\bHP 2-C\b|\b2 ?- ?Cycle\b|\bTCW/i, "2-Cycle – silniki dwusuwowe"],
  [/\bMotor Oil\b/i, "High Performance Motor Oil"],
];
export function productFacts(name: string): ProductFacts {
  const volume = name.match(/\(([\d,.]+\s?(?:l|ml))\)/i);
  const grade = name.match(/\b(\d{1,2}W[- ]?\d{2,3}|SAE\s?\d{2})\b/i);
  const series = seriesNames.find(([re]) => re.test(name))?.[1] ?? null;
  const title = name
    .replace(/\s*\([\d,.]+\s?(?:l|ml)\)\s*/i, " ")
    .replace(/^Royal Purple\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: title || name,
    grade: grade ? grade[1].toUpperCase().replace(/W-?/, "W-") : null,
    series,
    volume: volume ? volume[1].replace(/\s+/, " ") : null,
  };
}
