* Fix erreurs type Client / Server context
    * Server side: ServerContext
    * Client side: ClientContext | ServerContext
    * PageResponse extends Response
* Toast service
* ClientApplication hooks
    app.on('bug')
    app.on('error')


# Dependancies injection

# Full stack Pages

```typescript
import Router from '@server/services/router';
import { TRouterContext as ServerServices } from '@server/services/router/response';
import { TRouterContext as ClientServices } from '@client/services/router/response';

abstract class Controller< 
    TRouter extends Router, 
    TData extends any = any,
    TUserAccess extends string = string
> {

    abstract auth: TUserAccess;

    abstract get( services: ServerServices<TRouter> ): Promise<TData>;

    abstract render( context: TData, services: ClientServices<TRouter> ): ComponentChild;

}
```

```typescript
//? /headhunter/missions/suggested'
class Missions extends Controller<CrossPath["router"]> {

    auth = 'USER';

    async get({ headhunting, response, auth  }) {

        const user = await auth.check('USER');

        const suggested =  await headhunting.missions.Suggest( user );
    
        return { suggested }
    }

    render({ page, api, suggested }) {
        return (
            <Page title="App title here" subtitle="SEO description here">{page.loading || <>
    
                <section class="col">
    
                    <header class="row">
                        <h2 class="col-1">Suggested Missions</h2>
                    </header>
    
                    <div class="grid xa3">
                        {suggested.map( mission => (
                            <MissionCard mission={mission} />
                        ))}
                    </div>
                </section>
    
            </>}</Page>
        )
    }
}
```