# Disallowed

- To destructure page data objects

```
route.page('/withdraw', { bodyId: 'withdraw' }, ({}, { api }) => ({

    withdraw: api.get('/withdraw')

}), ({ withdraw: { history, balance, minimum, fees } }, { api, modal, page, user }) => {

    ...
```

Do instead:

```
route.page('/withdraw', { bodyId: 'withdraw' }, ({}, { api }) => ({

    withdraw: api.get('/withdraw')

}), ({ withdraw }, { api, modal, page, user }) => {

    const { history, balance, minimum, fees } = withdraw;

    ...
```