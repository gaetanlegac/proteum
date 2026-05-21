import {
    defineAction,
    defineController,
    schema,
    type TControllerActionInput,
} from '@server/app/controller';

type Assert<T extends true> = T;

type Equals<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
        ? true
        : false
    : false;

const controller = defineController({
    actions: {
        fromShape: defineAction({
            input: {
                name: schema.string(),
                age: schema.number().optional(),
            },
            handler: ({ input }) => input,
        }),
        fromSchema: defineAction({
            input: schema.object({
                slug: schema.string(),
            }),
            handler: ({ input }) => input,
        }),
    },
});

type TFromShape = TControllerActionInput<typeof controller, 'fromShape'>;
type TFromSchema = TControllerActionInput<typeof controller, 'fromSchema'>;

type _AssertShapeInference = Assert<
    Equals<
        TFromShape,
        {
            name: string;
            age?: number | undefined;
        }
    >
>;

type _AssertSchemaInference = Assert<
    Equals<
        TFromSchema,
        {
            slug: string;
        }
    >
>;
