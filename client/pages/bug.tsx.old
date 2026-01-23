/*----------------------------------
- DEPENDANCES
----------------------------------*/
// Npm
import React from 'react';

// Core components
import { Button, Input } from '@client/components';
import Card, { Props as CardProps } from '@client/components/Dialog/card';

// Core libs
import useContext from '@/client/context';

/*----------------------------------
- TYPES
----------------------------------*/

export default ({ ...self }: {} & CardProps) => {

    const { api, modal, clientBug } = useContext();

    const [observation, setObservation] = React.useState("");
    const [before, setBefore] = React.useState("");

    const send = () => clientBug({ observation, before }).then(() =>
        modal.success("Thanks You !", `Your bug report will be review in the next 12 hours.`).then(() =>
            self.close(true)
        )
    );

    const close = () => modal.confirm("Cancel your report ?", "All your changes will not be saved.").then(close =>
        close && self.close(true)
    );

    self.onClose = close

    return (
        <Card {...self} title="Report a problem" footer={<>

            <Button onClick={() => close()}>
                Cancel
            </Button>

            <Button type="primary" onClick={send}>
                Send Report
            </Button>

        </>}>

            <p>What's the problem ?</p>

            <Input type="longtext" title="Description of the problem" value={observation} onChange={setObservation} />

            <p>What did you do just before the problem occurs ?</p>

            <Input type="longtext" title="How the problem occured ?" value={before} onChange={setBefore} />

        </Card>
    )
}