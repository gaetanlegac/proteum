
const number = (nb: number, decimals: number = 2) => 
    typeof nb === 'number' ? nb.toLocaleString(undefined, {
        //minimumFractionDigits: decimals, 
        maximumFractionDigits: decimals
    }) : '?';

export default {
    number,
    credits: (nb: number, decimals: number = 0) => number(nb, decimals),
    dollars: (nb: number, decimals: number = 6) => number(nb, decimals),
    bitcoin: (nb: number, decimals: number = 8) => number(nb, decimals),
    satoshi: Math.round,
}