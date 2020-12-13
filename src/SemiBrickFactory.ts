import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLID,
  GraphQLList,
  GraphQLNamedType,
  GraphQLSchema,
  GraphQLString,
  GraphQLType,
} from 'graphql';
import { AnySemiBrick, SemiGraphQLTypeOf } from './Brick';
import { EnumSemiBrick, StringKeys } from './types/Enum';
import { Implementors } from './types/Implementor';
import { InputListSemiBrick } from './types/InputList';
import { InputObjectSemiBrick } from './types/InputObject';
import { InterfaceSemiBrick } from './types/Interface';
import { OutputListSemiBrick } from './types/OutputList';
import { OutputObjectSemiBrick } from './types/OutputObject';
import { ScalarSemiBrick } from './types/Scalar';
import {
  AnyOutputSemiBrick,
  AnyInputSemiBrick,
  InputFieldConfigMap,
} from './types/struct-types';
import { UnionSemiBrick, UnitableSemiBricks } from './types/Union';
import { OutputFieldMap, RootQueryOutputFieldMap } from './OutputField';

interface SemiBricksMap {
  [key: string]: AnySemiBrick;
}

interface GraphQLTypesMap {
  [key: string]: GraphQLType;
}

export class SemiBrickFactory {
  // TODO: put all the semibricks in the order they are initialized here.
  private readonly semiBricks: SemiBricksMap = {};
  private readonly graphQLTypes: GraphQLTypesMap = {};
  private readonly rootQueryFieldMaps: RootQueryOutputFieldMap[] = [];
  private readonly mutationFieldMaps: RootQueryOutputFieldMap[] = [];

  constructor() {
    const scalar = this.scalar();
    Object.values(scalar).forEach(this.registerSemiBrick);
  }

  public getAllNamedSemiGraphQLTypes = (): GraphQLNamedType[] => {
    const allSemiGraphQLTypes = Object.values(this.semiBricks).map((sb) =>
      sb.getSemiGraphQLType(),
    );
    return allSemiGraphQLTypes.filter((x) => !(x instanceof GraphQLList));
  };

  private registerSemiBrick = (sb: AnySemiBrick) => {
    if (this.semiBricks[sb.name]) {
      throw new Error(
        `SemiBrick with name: ${sb.name} already exists. Try a different name.`,
      );
    }
    this.semiBricks[sb.name] = sb;
    return sb;
  };

  public getSemiGraphQLTypeOf = (
    sb: AnySemiBrick,
    fallback: () => SemiGraphQLTypeOf<typeof sb>,
  ): SemiGraphQLTypeOf<typeof sb> => {
    const cachedType: GraphQLType | undefined = this.graphQLTypes[sb.name];
    if (cachedType) {
      return cachedType;
    }
    const fresh = fallback();
    this.graphQLTypes[sb.name] = fresh;

    return fresh;
  };

  // TODO: find a way to avoid doing this delayed execution
  scalar = () => ({
    id: new ScalarSemiBrick<string | number, 'ID'>({
      semiBrickFactory: this,
      name: 'ID',
      semiGraphQLType: GraphQLID,
    }),

    // TODO: see if you can avoid typing the Name param twice
    string: new ScalarSemiBrick<string, 'String'>({
      semiBrickFactory: this,
      name: 'String',
      semiGraphQLType: GraphQLString,
    }),

    float: new ScalarSemiBrick<number, 'Float'>({
      semiBrickFactory: this,
      name: 'Float',
      semiGraphQLType: GraphQLFloat,
    }),

    // int: new ScalarSemiBrick({ // TODO: get back here and reimplement
    //   semiBrickFactory: this,
    //   name: 'Int',
    //   semiGraphQLType: GraphQLInt,
    // }),

    boolean: new ScalarSemiBrick<boolean, 'Boolean'>({
      semiBrickFactory: this,
      name: 'Boolean',
      semiGraphQLType: GraphQLBoolean,
    }),
  });

  enum = <D extends StringKeys, N extends string>(params: {
    name: N;
    description?: string;
    keys: D;
  }): EnumSemiBrick<N, D> => {
    const sb = new EnumSemiBrick({
      semiBrickFactory: this,
      name: params.name,
      keys: params.keys,
    });
    this.registerSemiBrick(sb);
    return sb;
  };

  inputList = <SB extends AnyInputSemiBrick>(
    listOf: SB,
  ): InputListSemiBrick<SB> => {
    const sb = new InputListSemiBrick({
      semiBrickFactory: this,
      name: `InputListOf<${listOf.name}>`,
      listOf: listOf,
    });
    this.registerSemiBrick(sb);
    return sb;
  };

  inputObject = <F extends InputFieldConfigMap, N extends string>(params: {
    name: N;
    fields: F;
  }): InputObjectSemiBrick<F, N> => {
    const sb = new InputObjectSemiBrick({
      semiBrickFactory: this,
      name: params.name,
      fields: params.fields,
    });
    this.registerSemiBrick(sb);
    return sb;
  };

  interface = <
    F extends OutputFieldMap,
    I extends Implementors<F>,
    N extends string
  >(params: {
    name: N;
    fields: F;
    implementors: I;
  }): InterfaceSemiBrick<F, I, N> => {
    const sb = new InterfaceSemiBrick({
      semiBrickFactory: this,
      name: params.name,
      fields: params.fields,
      implementors: params.implementors,
    });
    this.registerSemiBrick(sb);
    return sb;
  };

  outputList = <SB extends AnyOutputSemiBrick>(params: {
    listOf: SB;
  }): OutputListSemiBrick<SB> => {
    const sb = new OutputListSemiBrick({
      semiBrickFactory: this,
      name: `OutputListOf<${params.listOf.name}>`,
      listOf: params.listOf,
    });
    this.registerSemiBrick(sb);
    return sb;
  };

  outputObject = <F extends OutputFieldMap, N extends string>(params: {
    name: N;
    fields: F;
  }): OutputObjectSemiBrick<F, N> => {
    const sb = new OutputObjectSemiBrick({
      semiBrickFactory: this,
      name: params.name,
      fields: {},
    });
    this.registerSemiBrick(sb);
    // @ts-ignore // TODO: figure this out
    sb.fields = params.fields;
    return sb as any;
  };

  recursive = <F extends OutputFieldMap, N extends string>(params: {
    name: N;
    fields: F;
  }): OutputObjectSemiBrick<F, N> => {
    return this.semiBricks[params.name] as any;
  };
  // TODO: warn the user when they try to register the same query field.
  rootQuery = <F extends RootQueryOutputFieldMap>(params: {
    fields: F;
  }): void => {
    this.rootQueryFieldMaps.push(params.fields);
  };

  mutation = <F extends RootQueryOutputFieldMap>(params: {
    fields: F;
  }): void => {
    this.mutationFieldMaps.push(params.fields);
  };

  union = <SBS extends UnitableSemiBricks, N extends string>(params: {
    name: N;
    semiBricks: SBS;
  }): UnionSemiBrick<SBS, N> => {
    const sb = new UnionSemiBrick({
      semiBrickFactory: this,
      name: params.name,
      semiBricks: params.semiBricks,
    });
    this.registerSemiBrick(sb);
    return sb;
  };

  getGraphQLSchema = (): GraphQLSchema => {
    const rootQueryFields = {};
    const mutationFields = {};
    this.rootQueryFieldMaps.forEach((curRootQueryMap) => {
      Object.assign(rootQueryFields, curRootQueryMap);
    });
    this.mutationFieldMaps.forEach((cur) => {
      Object.assign(mutationFields, cur);
    });
    const Query = new OutputObjectSemiBrick({
      name: 'Query',
      semiBrickFactory: this,
      fields: rootQueryFields,
    });
    const Mutation = new OutputObjectSemiBrick({
      name: 'Mutation',
      semiBrickFactory: this,
      fields: mutationFields,
    });
    return new GraphQLSchema({
      query: Query.getSemiGraphQLType(),
      mutation: Mutation.getSemiGraphQLType(),
      types: this.getAllNamedSemiGraphQLTypes(),
    });
  };
}