// Scientists and mathematicians a team's agents are named after, so people can tell them apart at a glance.
const NAMES = [
  "Ada", "Agnesi", "Archimedes", "Babbage", "Bohr", "Boole", "Brahe", "Cantor", "Carver", "Cavendish", "Curie", "Darwin", "Dirac",
  "Euclid", "Euler", "Faraday", "Fermat", "Fermi", "Feynman", "Fibonacci", "Franklin", "Galileo", "Gauss", "Germain", "Gödel",
  "Goodall", "Hamilton", "Hawking", "Heisenberg", "Hertz", "Hilbert", "Hopper", "Hubble", "Huygens", "Hypatia", "Jemison", "Johnson",
  "Joule", "Kelvin", "Kepler", "Khayyam", "Knuth", "Kovalevskaya", "Lamarr", "Laplace", "Lavoisier", "Leavitt", "Leibniz", "Lovelace",
  "Maxwell", "McClintock", "Meitner", "Mendel", "Mendeleev", "Mirzakhani", "Napier", "Newton", "Noether", "Oppenheimer", "Pascal",
  "Pasteur", "Pauli", "Planck", "Poincaré", "Ptolemy", "Pythagoras", "Ramanujan", "Riemann", "Rutherford", "Sagan", "Salk", "Schrödinger",
  "Shannon", "Somerville", "Tesla", "Thales", "Turing", "Volta", "Von Neumann", "Wiles", "Wu", "Yalow", "Zuse",
];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
/** A nickname no agent of the team has yet; once every name is taken, names come round again as "Turing the 2nd". */
export function nickname(taken: ReadonlySet<string>, random: () => number = Math.random) {
  for (let round = 1; ; round++) {
    const free = NAMES.map(name => round === 1 ? name : `${name} the ${ordinal(round)}`).filter(name => !taken.has(name));
    if (free.length) return free[Math.floor(random() * free.length)]!;
  }
}
