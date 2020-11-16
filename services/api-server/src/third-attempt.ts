/* eslint @typescript-eslint/no-empty-interface: 0 */
import { ApolloServer, gql, UserInputError } from 'apollo-server-express';
import * as R from 'fp-ts/lib/Record';
import * as T from 'fp-ts/lib/Task';
import * as A from 'fp-ts/lib/Array';
import * as O from 'fp-ts/lib/Option';
import express from 'express';
import { data } from './cached/data';
import * as t from 'io-ts';
import { Lens } from 'monocle-ts';
import {
  GraphQLBoolean,
  GraphQLID,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLFloat,
  GraphQLList,
  GraphQLEnumType,
  GraphQLUnionType,
  GraphQLOutputType,
  GraphQLInputObjectType,
  GraphQLType,
  GraphQLScalarType,
  GraphQLNullableType,
  graphqlSync,
  isInputObjectType,
  coerceInputValue,
  GraphQLInputType,
} from 'graphql';
import { flow, not, pipe } from 'fp-ts/lib/function';
import { isLeft } from 'fp-ts/lib/Either';
import _ from 'lodash';

type Codec<A, O> = t.Type<A, O, unknown>;
type InputType = 'scalar' | 'enum' | 'inputobject' | 'list';
type OutputType =
  | 'scalar'
  | 'outputobject'
  | 'interface'
  | 'union'
  | 'enum'
  | 'list';
type Shape =
  | 'scalar'
  | 'outputobject'
  | 'interface'
  | 'union'
  | 'enum'
  | 'inputobject'
  | 'list';

interface ISemiBrick<S extends Shape, G extends GraphQLNullableType, A, O> {
  name: string;
  shape: S;
  unrealisedGraphQLType: G;
  unrealisedCodec: Codec<A, O>;
}

type Nullability = 'nullable' | 'notNullable';

// TODO: looks like we need to go back to generics...
// TODO: it also looks like we should start putting the nullability and the shape into the generics...
interface IBrick<
  S extends Shape,
  SB_G extends GraphQLNullableType,
  // TODO: make it so that B_G can either be SB_G or the NonNull version of it. punting for now...
  B_G extends GraphQLType,
  B_A,
  B_O,
  SB_A,
  SB_O
> extends ISemiBrick<S, SB_G, SB_A, SB_O> {
  nullability: Nullability;
  realisedGraphQLType: B_G;
  realisedCodec: Codec<B_A, B_O>;
}

type Brickified<T> = T extends IBrick<
  infer S,
  infer SB_G,
  infer B_G,
  infer B_A,
  infer B_O,
  infer SB_A,
  infer SB_O
>
  ? IBrick<S, SB_G, B_G, B_A, B_O, SB_A, SB_O>
  : never;

type SemiBrickified<T> = T extends ISemiBrick<
  infer S,
  infer G,
  infer A,
  infer O
>
  ? ISemiBrick<S, G, A, O>
  : never;

type BrickStruct<T> = {
  [P in keyof T]: T[P] extends IBrick<
    infer S,
    infer SB_G,
    infer B_G,
    infer B_A,
    infer B_O,
    infer SB_A,
    infer SB_O
  >
    ? IBrick<S, SB_G, B_G, B_A, B_O, SB_A, SB_O>
    : never;
};

type RealisedCodecsStruct<T> = {
  [P in keyof T]: T[P] extends IBrick<
    infer S,
    infer SB_G,
    infer B_G,
    infer B_A,
    infer B_O,
    infer SB_A,
    infer SB_O
  >
    ? Codec<B_A, B_O>
    : never;
};

// TODO: shutdown warnings for unused inferred generics
type RealisedGraphqlOutputTypesStruct<T> = {
  [P in keyof T]: T[P] extends IBrick<
    infer S,
    infer SB_G,
    infer B_G,
    infer B_A,
    infer B_O,
    infer SB_A,
    infer SB_O
  >
    ? // TODO: find a way to get rid of "type" here.
      { type: B_G extends GraphQLOutputType ? B_G : never }
    : never;
};

type RealisedGraphqlInputTypesStruct<T> = {
  [P in keyof T]: T[P] extends IBrick<
    infer S,
    infer SB_G,
    infer B_G,
    infer B_A,
    infer B_O,
    infer SB_A,
    infer SB_O
  >
    ? { type: B_G extends GraphQLInputType ? B_G : never }
    : never;
};
const id = {
  name: 'ID' as const,
  shape: 'scalar' as const,
  unrealisedCodec: t.union([t.string, t.number]),
  unrealisedGraphQLType: GraphQLID,
};

const string = {
  name: 'String' as const,
  shape: 'scalar' as const,
  unrealisedCodec: t.string,
  unrealisedGraphQLType: GraphQLString,
};

const float = {
  name: 'Float' as const,
  shape: 'scalar' as const,
  unrealisedCodec: t.number,
  unrealisedGraphQLType: GraphQLFloat,
};

const int = {
  name: 'Int' as const,
  shape: 'scalar' as const,
  unrealisedCodec: t.Int,
  unrealisedGraphQLType: GraphQLInt,
};

const boolean = {
  name: 'Boolean' as const,
  shape: 'scalar' as const,
  unrealisedCodec: t.boolean,
  unrealisedGraphQLType: GraphQLBoolean,
};

const makeNullable = <S extends Shape, G extends GraphQLNullableType, A, O>(
  sb: ISemiBrick<S, G, A, O>,
) => {
  const toReturn = {
    ...sb,
    nullability: 'nullable' as const,
    realisedCodec: t.union([sb.unrealisedCodec, t.undefined, t.null]),
    realisedGraphQLType: sb.unrealisedGraphQLType,
  };
  return <Brickified<typeof toReturn>>toReturn;
};

const makeNotNullable = <S extends Shape, G extends GraphQLNullableType, A, O>(
  sb: ISemiBrick<S, G, A, O>,
) => {
  const toReturn = {
    ...sb,
    nullability: 'notNullable' as const,
    realisedCodec: sb.unrealisedCodec,
    realisedGraphQLType: new GraphQLNonNull(sb.unrealisedGraphQLType),
  };

  return <Brickified<typeof toReturn>>toReturn;
};

const lift = <S extends Shape, G extends GraphQLNullableType, A, O>(
  sb: ISemiBrick<S, G, A, O>,
) => {
  makeNullable(sb);
  return {
    ...makeNotNullable(sb),
    nullable: makeNullable(sb),
  };
};

const scalars = {
  id: lift(id),
  string: lift(string),
  float: lift(float),
  int: lift(int),
  boolean: lift(boolean),
};

// const a = scalars.id.shape;
// const b = scalars.float.unrealisedCodec.encode(1);
// TODO: find a way to make the type names inferrable too...
// const c = scalars.float.realisedGraphQLType;
// const d = scalars.float.name;

// // TODO: as things stand, there's no straightforward way to make sure that the scalars passed for realised & unrealised gql types will refer to the same gql object.

const outputObject = <T, B extends BrickStruct<T>>(params: {
  name: string;
  fields: B;
}) => {
  const codecs = <RealisedCodecsStruct<typeof params.fields>>(
    _.mapValues(params.fields, (x) => x.realisedCodec)
  );
  const gqls = <RealisedGraphqlOutputTypesStruct<typeof params.fields>>(
    _.mapValues(params.fields, (x) => ({ type: x.realisedGraphQLType }))
  );

  const result = {
    name: params.name,
    shape: 'outputobject' as const,
    unrealisedCodec: t.type(codecs),
    unrealisedGraphQLType: new GraphQLObjectType({
      name: params.name,
      fields: gqls,
    }),
  };
  return lift(result);
};

// TODO: could we avoid the redundancy here?
const inputobject = <T, B extends BrickStruct<T>>(params: {
  name: string;
  fields: B;
}) => {
  const codecs = <RealisedCodecsStruct<typeof params.fields>>(
    _.mapValues(params.fields, (x) => x.realisedCodec)
  );
  const gqls = <RealisedGraphqlInputTypesStruct<typeof params.fields>>(
    _.mapValues(params.fields, (x) => ({ type: x.realisedGraphQLType }))
  );

  const result = {
    name: params.name,
    shape: 'inputobject' as const,
    unrealisedCodec: t.type(codecs),
    unrealisedGraphQLType: new GraphQLInputObjectType({
      name: params.name,
      fields: gqls,
    }),
  };
  return lift(result);
};

const person = outputObject({
  name: 'Person',
  fields: {
    id: scalars.string,
    firstName: scalars.float,
  },
});

export const myBroh = outputObject({
  name: 'MyBroh',
  fields: {
    person: person.nullable,
    friend: person.nullable,
    age: scalars.float,
  },
});

/**
 * TODO: is there a way to make convenience input objects directly out
 * of output objects? Not unless I keep meticulous records of everything as
 * tagged fields. We'd have to reconstruct them from the ground up
 */
export const nameInput = inputobject({
  name: 'NameInput',
  fields: {
    firstName: scalars.string,
    lastName: scalars.string,
  },
});

export const addressInput = inputobject({
  name: 'AddressInput',
  fields: {
    streetName: scalars.string,
    city: scalars.string,
    apartmentNo: scalars.int.nullable,
  },
});

export const registrationInput = inputobject({
  name: 'RegistrationInput',
  fields: {
    name: nameInput,
    address: addressInput,
  },
});