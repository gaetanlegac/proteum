import hInterval from 'human-interval';

type TObjDonneesStats = { [cheminStats: string]: number }
export type TStat<TDonnees extends TObjDonneesStats> = { date: string } & TDonnees
export type TTimeStat<TDonnees extends TObjDonneesStats> = { time: number } & TDonnees

/*----------------------------------
- OUTILS DE TRAITEMENT
----------------------------------*/
type TRetourStats<TDonnees extends TObjDonneesStats> = {
    graph: TTimeStat<TDonnees>[],
    total: TDonnees,

    start: Date,
    end: Date,
    interval: number,
}

export const buildStats = <TDonnees extends TObjDonneesStats>(
    periodStr: string,
    intervalStr: string,
    data: TStat<TDonnees>[]
): TRetourStats<TDonnees> => {

    // NOTE: On ne génère pas le timestamp via la bdd pour éviter les incohérences de timezone

    if (!Array.isArray(data)) {
        console.log('data =', data);
        throw new Error(`Stats data must be an array (received ${typeof data}). See console for full provided data.`);
    }

    const periodTime = hInterval(periodStr);
    if (periodTime === undefined) throw new Error(`Invalid period string`);
    const intervalTime = hInterval(intervalStr);
    if (intervalTime === undefined) throw new Error(`Invalid interval string`);

    let start = Date.now() - periodTime
    start -= start % intervalTime; // Round start date to the specified interval
    const end = Date.now()

    const total: TDonnees = {} as TDonnees
    let graph: TTimeStat<TDonnees>[] = []
    if (data.length > 0) {

        // Group data by time
        const groups: { [timestamp: number]: TTimeStat<TDonnees> } = {};
        for (const { date, ...stats } of data) {

            if (date === undefined)
                throw new Error(`La date est absente des données statistiques. Est-elle bien spécifiée dans le SELECT ?`);

            const timeA = new Date(date).getTime();
            groups[timeA] = { time: timeA, ...stats };
        }

        // Completion
        for (let timeA = start; timeA <= end; timeA += intervalTime) {

            const stats = { time: timeA, ...total }

            if (groups[timeA] !== undefined)
                for (const nom in groups[timeA]) {

                    // numeric value only
                    if (typeof groups[timeA][nom] !== 'number')
                        continue;

                    // Add cumulated value
                    stats[nom] = stats[nom] === undefined
                        ? groups[timeA][nom]
                        : stats[nom] + groups[timeA][nom];

                    total[nom] = stats[nom];

                }

            graph.push(stats);

        }
    }

    return { 
        graph, 
        total, 
        start: new Date(start), 
        end: new Date(end),
        interval: intervalTime
    };

}