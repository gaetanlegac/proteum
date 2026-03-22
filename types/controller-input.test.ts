import Controller, { schema } from '@server/app/controller';

type Assert<T extends true> = T;

type Equals<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
        ? true
        : false
    : false;

class InputInferenceController extends Controller {
    public fromShape() {
        return this.input({
            name: schema.string(),
            age: schema.number().optional(),
        });
    }

    public fromSchema() {
        return this.input(
            schema.object({
                slug: schema.string(),
            }),
        );
    }
}

type TFromShape = ReturnType<InputInferenceController['fromShape']>;
type TFromSchema = ReturnType<InputInferenceController['fromSchema']>;

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
