// remplace .toFixed qui retourne une chaine
export const toFixedNumber = ( nb: number, x: number, base: number = 10 ): number => {
    var pow = Math.pow(base, x);
    return Math.round(nb * pow) / pow;
}

export const div = (a: number, b: number, conserver: boolean = false) => b !== 0 ? a / b : (conserver ? 1 : 0);

export const getVariation = (val: number, ref: number) => {
    const variation = ref > 0
        ? Math.round((val - ref) / ref * 100 * 100) / 100
        : 100;
    const txt = (variation < 0 ? variation.toFixed(2) : '+' + variation.toFixed(2)) + '%';
    const couleur = variation < 0 ? 'rouge' : 'vert';
    const sens = variation < 0 ? 'down' : 'up';
    return { val: variation, txt, couleur, sens }
}

export const minmax = (val: number, min: number, max: number) =>
    val > max ? max : val < min ? min : val;