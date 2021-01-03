import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFieldConfig,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputFieldConfig,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  GraphQLType,
  GraphQLUnionType,
  ValueNode,
} from 'graphql';
import {
  brandOf,
  Maybe,
  Promisable,
  Thunkable,
  unthunk,
  Unthunked,
} from './utils';
import { forEach, mapValues } from 'lodash';
import { ApolloServer } from 'apollo-server-express';
import express from 'express';

interface StringKeys<T> {
  [key: string]: T;
}

type GraphQLContext = StringKeys<unknown>;

type ContextGetter<C extends GraphQLContext> = () => C;

type AnyType = BaseType<any, any>;

type AnyTypeContainer = TypeContainer<any>;

type FallbackGraphQLTypeFn = (typeContainer: AnyTypeContainer) => GraphQLType;

type ResolverFnOf<R extends OutputRealizedType, S, A, C> = (
  source: S,
  args: TypeOfTypeStruct<TypeStructOfInputFieldConstructorArgsMap<A>>,
  context: C,
) => Promisable<ResolverReturnTypeOf<R>>;

type ArgsMap = StringKeys<InputFieldConstructorArg>;

class RootQueryField<
  R extends OutputRealizedType,
  A extends ArgsMap,
  C extends GraphQLContext
> {
  public readonly type: R;
  public readonly args: A;
  public readonly resolve: ResolverFnOf<R, undefined, A, C>;

  constructor(params: {
    type: RootQueryField<R, A, C>['type'];
    args: RootQueryField<R, A, C>['args'];
    resolve: RootQueryField<R, A, C>['resolve'];
  }) {
    this.type = params.type;
    this.args = params.args;
    this.resolve = params.resolve;
  }

  public getGraphQLFieldConfig(
    typeContainer: AnyTypeContainer,
  ): GraphQLFieldConfig<any, any, any> {
    return {
      type: this.type.getGraphQLType(typeContainer) as any,
      args: mapValues(this.args, (arg, key) => {
        const field = toInputField(arg);
        const type = field.getGraphQLInputFieldConfig(typeContainer);
        return type;
      }),
      resolve: this.resolve,
    };
  }
}

export class TypeContainer<C extends GraphQLContext> {
  private readonly contextGetter: ContextGetter<C>;
  private readonly internalGraphQLTypes: StringKeys<GraphQLType> = {
    String: GraphQLString,
    Float: GraphQLFloat,
    Int: GraphQLInt,
    Boolean: GraphQLBoolean,
    ID: GraphQLID,
  };
  private readonly rootQueries: StringKeys<
    RootQueryField<OutputRealizedType, any, C>
  > = {};

  constructor(params: { contextGetter: ContextGetter<C> }) {
    this.contextGetter = params.contextGetter;
  }

  public getInternalGraphQLType(
    type: AnyType,
    fallback: FallbackGraphQLTypeFn,
  ): GraphQLType {
    const existingType = this.internalGraphQLTypes[type.name];
    if (existingType) {
      return existingType;
    } else {
      const newType = fallback(this);
      this.internalGraphQLTypes[type.name] = newType;
      return this.getInternalGraphQLType(type, fallback);
    }
  }

  public query(fields: StringKeys<RootQueryField<any, any, C>>): void {
    forEach(fields, (field, key) => {
      this.rootQueries[key] = field;
    });
  }

  public getSchema(): GraphQLSchema {
    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: mapValues(this.rootQueries, (rootQuery) =>
          rootQuery.getGraphQLFieldConfig(this),
        ),
      }),
    });
  }
}

abstract class BaseType<N extends string, I> {
  public readonly name: N;
  public readonly __INTERNAL_TYPE__!: I;

  constructor(params: { name: N }) {
    this.name = params.name;
  }

  protected abstract getFreshInternalGraphQLType(
    typeContainer: AnyTypeContainer,
  ): GraphQLType;

  public getInternalGraphQLType = (
    typeContainer: AnyTypeContainer,
  ): GraphQLType => {
    const fallback = this.getFreshInternalGraphQLType.bind(this);
    return typeContainer.getInternalGraphQLType(this, fallback);
  };
}

class RealizedType<T extends AnyType, N extends boolean> {
  public readonly internalType: T;
  public readonly isNullable: N;
  public __BRAND__ = 'realizedtype';

  public constructor(params: { internalType: T; isNullable: N }) {
    this.internalType = params.internalType;
    this.isNullable = params.isNullable;
  }

  public get name() {
    return this.internalType.name;
  }

  public get nullable(): RealizedType<T, true> {
    return new RealizedType({
      internalType: this.internalType,
      isNullable: true,
    });
  }

  public getGraphQLType(typeContainer: AnyTypeContainer): GraphQLType {
    const internalGraphQLType = this.internalType.getInternalGraphQLType(
      typeContainer,
    );
    const externalGraphQLType = this.isNullable
      ? internalGraphQLType
      : new GraphQLNonNull(internalGraphQLType);

    return externalGraphQLType;
  }
}

type ScalarSerializer<TInternal> = (value: TInternal) => Maybe<any>;
type ScalarValueParser<TInternal> = (value: unknown) => Maybe<TInternal>;
type ScalarLiteralParser<TInternal> = (
  valueNode: ValueNode,
  variables: Maybe<{ [key: string]: any }>, // TODO: try a better type for serializers
) => Maybe<TInternal>;

interface IScalarTypeConstructorParams<N extends string, I> {
  name: N;
  description?: Maybe<string>;
  specifiedByUrl?: Maybe<string>;
  serialize: ScalarType<N, I>['serializer'];
  parseValue: ScalarType<N, I>['valueParser'];
  parseLiteral: ScalarType<N, I>['literalParser'];
}

class ScalarType<N extends string, I> extends BaseType<N, I> {
  public readonly description?: Maybe<string>;
  public readonly specifiedByUrl?: Maybe<string>;

  private readonly serializer: ScalarSerializer<I>;
  private readonly valueParser: ScalarValueParser<I>;
  private readonly literalParser: ScalarLiteralParser<I>;

  constructor(params: IScalarTypeConstructorParams<N, I>) {
    super(params);
    this.description = params.description;
    this.specifiedByUrl = params.specifiedByUrl;
    this.serializer = params.serialize;
    this.valueParser = params.parseValue;
    this.literalParser = params.parseLiteral;
  }

  protected getFreshInternalGraphQLType(): GraphQLScalarType {
    return new GraphQLScalarType({
      name: this.name,
      description: this.description,
      specifiedByUrl: this.specifiedByUrl,
      serialize: this.serializer,
      parseValue: this.valueParser,
      parseLiteral: this.literalParser,
    });
  }
}

const scalar = <N extends string, I>(
  params: IScalarTypeConstructorParams<N, I>,
): RealizedType<ScalarType<N, I>, false> => {
  const scalarType = new ScalarType(params);
  return new RealizedType({
    internalType: scalarType,
    isNullable: false,
  });
};

const String = scalar<'String', string>({
  name: 'String',
  parseLiteral: GraphQLString.parseLiteral,
  parseValue: GraphQLString.parseValue,
  serialize: GraphQLString.serialize,
  description: GraphQLString.description,
  specifiedByUrl: GraphQLString.specifiedByUrl,
});

const Int = scalar<'Int', number>({
  name: 'Int',
  parseLiteral: GraphQLInt.parseLiteral,
  parseValue: GraphQLInt.parseValue,
  serialize: GraphQLInt.serialize,
  description: GraphQLInt.description,
  specifiedByUrl: GraphQLInt.specifiedByUrl,
});

const Boolean = scalar<'Boolean', boolean>({
  name: 'Boolean',
  parseLiteral: GraphQLBoolean.parseLiteral,
  parseValue: GraphQLBoolean.parseValue,
  serialize: GraphQLBoolean.serialize,
  description: GraphQLBoolean.description,
  specifiedByUrl: GraphQLBoolean.specifiedByUrl,
});

const Float = scalar<'Float', number>({
  name: 'Float',
  parseLiteral: GraphQLFloat.parseLiteral,
  parseValue: GraphQLFloat.parseValue,
  serialize: GraphQLFloat.serialize,
  description: GraphQLFloat.description,
  specifiedByUrl: GraphQLFloat.specifiedByUrl,
});

const ID = scalar<'ID', number | string>({
  name: 'ID',
  parseLiteral: GraphQLID.parseLiteral,
  parseValue: GraphQLID.parseValue,
  serialize: GraphQLID.serialize,
  description: GraphQLID.description,
  specifiedByUrl: GraphQLID.specifiedByUrl,
});

interface IEnumValue {
  deprecationReason?: string;
  description?: string;
}

type EnumValuesMap = StringKeys<IEnumValue | null>;

interface IEnumTypeConstructorParams<
  N extends string,
  D extends EnumValuesMap
> {
  name: N;
  description?: string;
  values: D;
}

class EnumType<N extends string, D extends EnumValuesMap> extends BaseType<
  N,
  keyof D
> {
  public readonly description?: string;
  public readonly valuesConfig: D;

  public constructor(params: IEnumTypeConstructorParams<N, D>) {
    super(params);
    this.description = params.description;
    this.valuesConfig = params.values;
  }

  public get values(): { [K in keyof D]: K } {
    return mapValues(this.valuesConfig, (value, key) => key) as any;
  }

  protected getFreshInternalGraphQLType(): GraphQLEnumType {
    return new GraphQLEnumType({
      name: this.name,
      description: this.description,
      values: mapValues(this.valuesConfig, (value, key) => {
        return {
          value: key,
          description: value?.description,
          deprecationReason: value?.deprecationReason,
        };
      }),
    });
  }
}

export const enu = <N extends string, D extends EnumValuesMap>(
  params: IEnumTypeConstructorParams<N, D>,
): RealizedType<EnumType<N, D>, false> => {
  const internalType = new EnumType(params);
  return new RealizedType({
    internalType,
    isNullable: false,
  });
};

const Membership = enu({
  name: 'Membership',
  values: {
    enterprise: null,
    free: null,
    paid: null,
  },
});

type Unionable = ObjectType<any, any> | RealizedType<ObjectType<any, any>, any>;

type Unionables = Thunkable<[Unionable, Unionable, ...Array<Unionable>]>;
interface IUnionTypeConstructorParams<N extends string, U extends Unionables> {
  name: UnionType<N, U>['name'];
  types: UnionType<N, U>['types'];
  description?: UnionType<N, U>['description'];
  resolveType?: UnionType<N, U>['resolveType'];
}

type ResolveTypeFnOf<U extends Unionables> = (
  resolved: InternalResolverReturnTypeOfUnionType<
    RealizedType<UnionType<any, U>, any>
  >,
) => Required<typeof resolved['__typename']>;

class UnionType<N extends string, U extends Unionables> extends BaseType<
  N,
  Unthunked<U>[number]
> {
  public readonly types: U;
  public readonly description?: string;
  public readonly resolveType?: ResolveTypeFnOf<U>;

  constructor(params: IUnionTypeConstructorParams<N, U>) {
    super(params);
    this.types = params.types;
    this.resolveType = params.resolveType;
  }

  protected getFreshInternalGraphQLType(
    typeContainer: AnyTypeContainer,
  ): GraphQLUnionType {
    const unthunkedTypes = unthunk(this.types);
    const types = unthunkedTypes.map((type) => {
      if (type instanceof RealizedType) {
        return type.internalType.getInternalGraphQLType(typeContainer);
      } else {
        return type.getInternalGraphQLType(typeContainer);
      }
    });
    return new GraphQLUnionType({
      name: this.name,
      description: this.description,
      types: types as any,
      resolveType: this.resolveType as any,
    });
  }
}

// TODO: find a way to make sure no 2 conflicting types can be unioned. For example,
// an object with .id: ID and another with .id: String.

const union = <N extends string, U extends Unionables>(
  params: IUnionTypeConstructorParams<N, U>,
): RealizedType<UnionType<N, U>, false> => {
  const internalType = new UnionType(params);
  return new RealizedType({
    internalType,
    isNullable: false,
  });
};

type OutputType =
  | ScalarType<any, any>
  | ObjectType<any, any>
  | UnionType<any, any>
  | EnumType<any, any>
  | ListType<OutputRealizedType>;

type InputType =
  | ScalarType<any, any>
  | UnionType<any, any>
  | EnumType<any, any>
  | InputObject<any, any>
  | ListType<InputRealizedType>;

type OutputRealizedType = RealizedType<OutputType, any>;
type InputRealizedType = RealizedType<InputType, any>;

class ObjectField<R extends OutputRealizedType> {
  public readonly type: R;
  public readonly __BRAND__ = 'objectfield';

  constructor(params: { type: R }) {
    this.type = params.type;
  }

  public getGraphQLFieldConfig(
    typeContainer: AnyTypeContainer,
  ): GraphQLFieldConfig<any, any, any> {
    return {
      type: this.type.getGraphQLType(typeContainer) as any,
      // deprecationReason: 123, // TODO: implement
      // description: 123,
      // resolve: 123,
    };
  }
}

type OutputFieldConstructorArg = OutputRealizedType | ObjectField<any>;

type OutputFieldConstructorArgsMapValueOf<
  R extends OutputRealizedType
> = Thunkable<R | ObjectField<R>>;

interface OutputFieldConstructorArgsMap {
  [key: string]: Thunkable<OutputFieldConstructorArg>;
}

interface IObjectTypeConstructorParams<
  N extends string,
  F extends OutputFieldConstructorArgsMap
> {
  name: N;
  fields: F;
}

type TypeInOutputFieldConstructorArg<
  A extends OutputFieldConstructorArg
> = A extends OutputRealizedType
  ? A
  : A extends ObjectField<any>
  ? A['type']
  : never;

type ObjectFieldInOutputFieldConstructorArg<
  A extends OutputFieldConstructorArg
> = ObjectField<TypeInOutputFieldConstructorArg<A>>;

const toObjectField = <A extends OutputFieldConstructorArg>(
  a: A,
): ObjectFieldInOutputFieldConstructorArg<A> => {
  if (brandOf(a) == 'realizedtype') {
    return new ObjectField({ type: a as any });
  } else if (brandOf(a) == 'objectfield') {
    return a as any;
  } else {
    throw new Error(`Unrecognized brand: ${brandOf(a)}`);
  }
};

type ExternalTypeOf<R extends RealizedType<any, any>> = TypeRealization<
  R,
  R['internalType']['__INTERNAL_TYPE__']
>;

class ObjectType<
  N extends string,
  F extends OutputFieldConstructorArgsMap
> extends BaseType<
  N,
  TypeOfTypeStruct<TypeStructOfOutputFieldConstructorArgsMap<F>>
> {
  public readonly fields: F;

  constructor(params: IObjectTypeConstructorParams<N, F>) {
    super(params);
    this.fields = params.fields;
  }

  protected getFreshInternalGraphQLType(
    typeContainer: AnyTypeContainer,
  ): GraphQLType {
    return new GraphQLObjectType({
      name: this.name,
      // interfaces TODO: implement
      // resolveObject: TODO: implement
      // isTypeOf: TODO: implement
      fields: () =>
        mapValues(this.fields, (field) => {
          const unthunkedField = unthunk(field);
          const baseOutputField = toObjectField(unthunkedField);
          return baseOutputField.getGraphQLFieldConfig(typeContainer);
        }),
    });
  }
}

const objectType = <N extends string, F extends OutputFieldConstructorArgsMap>(
  params: IObjectTypeConstructorParams<N, F>,
): RealizedType<ObjectType<N, F>, false> => {
  const internalType = new ObjectType(params);
  return new RealizedType({
    internalType,
    isNullable: false,
  });
};

class ListType<
  T extends RealizedType<BaseType<any, any>, any>
> extends BaseType<string, T> {
  public readonly type: T;

  constructor(params: { type: T }) {
    super({ name: `List<${params.type.name}>` });
    this.type = params.type;
  }

  protected getFreshInternalGraphQLType(
    typeContainer: AnyTypeContainer,
  ): GraphQLList<any> {
    return new GraphQLList(this.type.getGraphQLType(typeContainer));
  }
}

const __list = <T extends RealizedType<any, any>>(type: T) => {
  const internalType = new ListType({
    type,
  });
  return new RealizedType({
    internalType,
    isNullable: false,
  });
};

export const list = <T extends OutputRealizedType>(
  type: T,
): RealizedType<ListType<T>, false> => {
  return __list(type);
};

export const inputlist = <T extends InputRealizedType>(
  type: T,
): RealizedType<ListType<T>, false> => {
  return __list(type);
};

type InputFieldConstructorArg =
  | InputRealizedType
  | InputField<InputRealizedType>;

type TypeInInputFieldConstructorArg<
  A extends InputFieldConstructorArg
> = A extends InputRealizedType
  ? A
  : A extends InputField<any>
  ? A['type']
  : never;

type InputFieldInInputFieldConstructorArg<
  A extends InputFieldConstructorArg
> = InputField<TypeInInputFieldConstructorArg<A>>;

const toInputField = <A extends InputFieldConstructorArg>(
  x: InputFieldConstructorArg,
): InputFieldInInputFieldConstructorArg<A> => {
  const brand = brandOf(x);
  if (brand === 'inputfield') {
    return x as any;
  } else if (brand === 'realizedtype') {
    return new InputField({
      type: x as any,
    }) as any;
  }
  throw new Error(`Unrecogized brand: ${brand}`);
};

class InputField<R extends InputRealizedType> {
  public readonly type: R;
  public deprecationReason?: string;
  public description?: string;

  public readonly __BRAND__ = 'inputfield';

  // TODO: required arguments cant be deprecated.
  constructor(params: {
    type: R;
    deprecationReason?: string;
    description?: string;
  }) {
    this.type = params.type;
    this.deprecationReason = params.deprecationReason;
    this.description = params.description;
  }

  public getGraphQLInputFieldConfig(
    typeContainer: TypeContainer<any>,
  ): GraphQLInputFieldConfig {
    return {
      type: this.type.getGraphQLType(typeContainer) as any,
      deprecationReason: this.deprecationReason,
      description: this.description,
      // defaultValue TODO: implement
    };
  }
}

type InputFieldConstructorArgsMapValueOf<
  R extends InputRealizedType
> = Thunkable<R | InputField<R>>;

type InputFieldConstructorArgsMap = StringKeys<
  InputFieldConstructorArgsMapValueOf<any>
>;

interface IInputObjectConstructorArgs<
  N extends string,
  M extends InputFieldConstructorArgsMap
> {
  name: N;
  fields: M;
  description?: string;
}

class InputObject<
  N extends string,
  M extends InputFieldConstructorArgsMap
> extends BaseType<
  N,
  TypeOfTypeStruct<TypeStructOfInputFieldConstructorArgsMap<M>>
> {
  public readonly fields: M;
  public readonly description?: string;

  constructor(params: IInputObjectConstructorArgs<N, M>) {
    super(params);
    this.fields = params.fields;
    this.description = params.description;
  }

  protected getFreshInternalGraphQLType(
    typeContainer: AnyTypeContainer,
  ): GraphQLInputObjectType {
    return new GraphQLInputObjectType({
      name: this.name,
      description: this.description,
      fields: () => {
        return mapValues(this.fields, (field) => {
          const unthunkedField = unthunk(field);
          const inputField = toInputField(unthunkedField);
          return inputField.getGraphQLInputFieldConfig(typeContainer);
        });
      },
    });
  }
}

export const inputObject = <
  N extends string,
  M extends InputFieldConstructorArgsMap
>(
  params: IInputObjectConstructorArgs<N, M>,
): RealizedType<InputObject<N, M>, false> => {
  const internalType = new InputObject(params);
  return new RealizedType({
    internalType,
    isNullable: false,
  });
};

type TypeStruct = StringKeys<RealizedType<any, any>>;

type TypeStructOfOutputFieldConstructorArgsMap<
  F extends OutputFieldConstructorArgsMap
> = {
  [K in keyof F]: TypeInOutputFieldConstructorArg<Unthunked<F[K]>>;
};

type TypeStructOfInputFieldConstructorArgsMap<
  M extends InputFieldConstructorArgsMap
> = {
  [K in keyof M]: TypeInInputFieldConstructorArg<Unthunked<M[K]>>;
};

type TypeOfTypeStruct<S extends TypeStruct> = {
  [K in keyof S]: ExternalTypeOf<S[K]>;
};

type ResolverReturnTypeOfTypeStruct<S extends TypeStruct> = {
  [K in keyof S]: Thunkable<Promisable<ResolverReturnTypeOf<S[K]>>>;
};

type InternalResolverReturnTypeOfObjectType<
  R extends RealizedType<ObjectType<any, any>, any>
> = ResolverReturnTypeOfTypeStruct<
  TypeStructOfOutputFieldConstructorArgsMap<R['internalType']['fields']>
> & { __typename?: R['internalType']['name'] };

type InternalResolverReturnTypeOfUnionType<
  R extends RealizedType<UnionType<any, any>, any>
> = InternalResolverReturnTypeOfObjectType<
  Unthunked<R['internalType']['types']>[number]
>;

type InternalResolverReturnTypeOfListType<
  R extends RealizedType<ListType<OutputRealizedType>, any>
> = Array<Promisable<ResolverReturnTypeOf<R['internalType']['type']>>>;

// TODO: For union types, the typename isnt required for now. Get back to this later and
// make sure that either resolveType of `typename` is provided.

type ResolverReturnTypeOf<
  R extends OutputRealizedType
> = R extends RealizedType<ListType<any>, any>
  ? TypeRealization<R, InternalResolverReturnTypeOfListType<R>>
  : R extends RealizedType<ObjectType<any, any>, any>
  ? TypeRealization<R, InternalResolverReturnTypeOfObjectType<R>>
  : R extends RealizedType<UnionType<any, any>, any>
  ? TypeRealization<R, InternalResolverReturnTypeOfUnionType<R>>
  : ExternalTypeOf<R>;

const BestFriend = union({
  name: 'BestFriend',
  types: () => [Animal, User],
  resolveType: (x) => {
    if (x.__typename) {
      return x.__typename;
    }
    return 'Animal';
  },
});

type UserFields = {
  id: typeof ID;
  firstName: typeof String;
  lastName: typeof String['nullable'];
  self: OutputFieldConstructorArgsMapValueOf<UserType['nullable']>;
  pet: OutputFieldConstructorArgsMapValueOf<AnimalType['nullable']>;
  membership: typeof Membership['nullable'];
  bestFriend: typeof BestFriend['nullable'];
  bestFriends: OutputFieldConstructorArgsMapValueOf<
    RealizedType<ListType<typeof BestFriend['nullable']>, false>
  >; // TODO: make these easier.
  friends: OutputFieldConstructorArgsMapValueOf<
    RealizedType<ListType<UserType['nullable']>, false>
  >; // TODO: make these easier.
};

type UserType = RealizedType<ObjectType<'User', UserFields>, false>;

const User: UserType = objectType({
  name: 'User',
  fields: {
    id: ID,
    firstName: String,
    lastName: String.nullable,
    self: () => User.nullable,
    pet: () => Animal['nullable'],
    membership: Membership.nullable,
    bestFriend: BestFriend['nullable'],
    bestFriends: () => list(BestFriend.nullable),
    friends: () => list(User.nullable),
  },
});

// TODO: if the objectType implements the given type, but also adds a few
// extra fields, the frontend will falsely assume that these fields are implemented,
// even though they arent.

type TypeRealization<
  R extends OutputRealizedType,
  T
> = R['isNullable'] extends true ? Maybe<T> : T;

type AnimalType = RealizedType<
  ObjectType<
    'Animal',
    {
      id: typeof String;
      name: typeof String;
      owner: OutputFieldConstructorArgsMapValueOf<UserType['nullable']>; // TODO: make these generics simpler.
    }
  >,
  false
>;

const Animal: AnimalType = objectType({
  name: 'Animal',
  fields: {
    id: String,
    name: String,
    owner: () => User.nullable,
  },
});

const typeContainer = new TypeContainer({
  contextGetter: () => ({
    kerem: 'kazan',
  }),
});

const firstInputObject = inputObject({
  name: 'MyInputObject1',
  fields: {
    a: String,
  },
  description: 'some description here',
});

typeContainer.query({
  listOfThings: new RootQueryField({
    type: list(String),
    args: {},
    resolve: (root, args, context) => {
      // important: you cant return a list of thunks for a listType resolver.
      // however, you can return a list of promises.
      return [
        new Promise<string>((resolve) => {
          resolve('yo');
        }),
      ];
    },
  }),
  currentUser: new RootQueryField({
    // TODO: find a way to do this without having to use the constructor
    type: User,
    args: {
      x: String,
      y: new InputField({
        type: String.nullable,
        description: 'some desc',
      }),
      z: firstInputObject,
    },
    resolve: (root, args, context) => {
      return {
        id: 1,
        get self() {
          return this;
        },
        firstName: 'kerem',
        lastName: 'kazan',
        get pet() {
          return async () => ({
            id: () => 'petid',
            name: 'petname',
            owner: null,
          });
        },
        get bestFriends() {
          return () => [unthunk(this.pet), unthunk(this.bestFriend)];
        },
        membership: Membership.internalType.values.enterprise,
        get friends() {
          return [this, this, this, null, this, null];
        },
        bestFriend: () => ({
          // TODO: find a way to separate the typenames from each other (i.e Person shouldnt be applicable here.)
          __typename: 'Animal',
          name: () => 'some name',
          id: async () => 'some id',
          owner: null,
        }),
      };
    },
  }),
});

const schema = typeContainer.getSchema();

const apolloServer = new ApolloServer({
  schema,
});

const PORT = 4001;

const start = () => {
  const app = express();
  apolloServer.applyMiddleware({ app });

  // const url = id.getFreshSemiGraphQLType().specifiedByUrl;
  app.listen({ port: PORT }, () => {
    console.log(
      `🚀 Server ready at http://localhost:${PORT}${apolloServer.graphqlPath}`,
    );
  });
};

start();
