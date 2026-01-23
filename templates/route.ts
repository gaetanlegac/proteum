// Regex: \/server\/routes\/(?<PATH>.+)\.ts$

/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import route from '@router';

// App
import NAME from '@/server/libs/PATH';

/*----------------------------------
- ROUTES
----------------------------------*/

route.get('/PATH', async ({ user, request }) => {
    
    return await NAME.List(user, false, request);

});

route.get('/PATH/:id', async ({ schema, user }) => {

    const { id } = await schema.validate({
        id: schema.string()
    });

    return await NAME.Get(id, user);

});

route.post('/PATH/:id', async ({ auth, schema }) => {

    const user = await auth.check("USER");

    const { id } = await schema.validate({
        id: schema.string(),
    });

    return await NAME.Action(id, user);

});