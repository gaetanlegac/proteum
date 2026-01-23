import React from 'react';

export default (onChange?: (active: boolean) => void) => {
    
    const [active, setActive] = React.useState(true);

    React.useEffect(() => {

        // Avec import from, erreur document is undefined coté serveur
        const createActivityDetector = require('activity-detector').default;
        const activityDetector = createActivityDetector({
            inactivityEvents: ['blur', 'mouseleave']
        });

        activityDetector.on("idle", () => {
            if (onChange !== undefined) onChange(false);
            setActive(false)
        });

        activityDetector.on("active", () => {
            if (onChange !== undefined) onChange(true);
            setActive(true)
        });

        return () => activityDetector.stop();

    }, []);

    return active;
}