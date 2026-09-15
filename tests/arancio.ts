import { expect } from "chai";
import { AnchorProvider, Program, Wallet, web3 } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import { createProviderConnection } from "./helpers/provider";

const MAINNET_BETA_RPC_URL = "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey(
  "FwYP85cYksB7gHWe67CEUcYEFokikEUYGmf9ZGt8Qqgf"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const discriminator = (name: string): number[] =>
  Array.from(
    createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)
  );

const idl = {
  address: PROGRAM_ID.toBase58(),
  metadata: { name: "arancio", version: "0.1.0" },
  instructions: [
    {
      name: "initializeGlobalConfig",
      discriminator: discriminator("initialize_global_config"),
      accounts: [
        { name: "payer", writable: true, signer: true },
        { name: "globalConfig", writable: true },
        { name: "addressBook" },
        { name: "systemProgram" },
      ],
      args: [
        { name: "addressBook", type: "pubkey" },
        { name: "maxComponents", type: "u8" },
      ],
    },
    {
      name: "initializeAddressBook",
      discriminator: discriminator("initialize_address_book"),
      accounts: [
        { name: "authority", writable: true, signer: true },
        { name: "addressBook", writable: true },
        { name: "systemProgram" },
      ],
      args: [
        { name: "programIds", type: { defined: { name: "AddressBookInput" } } },
      ],
    },
    {
      name: "updateAddressBook",
      discriminator: discriminator("update_address_book"),
      accounts: [
        { name: "authority", signer: true },
        { name: "addressBook", writable: true },
      ],
      args: [
        { name: "programIds", type: { defined: { name: "AddressBookInput" } } },
      ],
    },
    {
      name: "freezeAddressBook",
      discriminator: discriminator("freeze_address_book"),
      accounts: [
        { name: "authority", signer: true },
        { name: "addressBook", writable: true },
      ],
      args: [],
    },
    {
      name: "createVault",
      discriminator: discriminator("create_vault"),
      accounts: [
        { name: "payer", writable: true, signer: true },
        { name: "globalConfig" },
        { name: "addressBook" },
        { name: "vaultConfig", writable: true },
        { name: "shareMint", writable: true },
        { name: "vaultAuthority" },
        { name: "tokenProgram" },
        { name: "systemProgram" },
      ],
      args: [
        { name: "name", type: { vec: "u8" } },
        { name: "inputMint", type: "pubkey" },
        {
          name: "components",
          type: { vec: { defined: { name: "ComponentInput" } } },
        },
      ],
    },
  ],
  types: [
    {
      name: "AddressBookInput",
      type: {
        kind: "struct",
        fields: [
          { name: "kaminoProgram", type: "pubkey" },
          { name: "jupiterProgram", type: "pubkey" },
          { name: "tokenProgram", type: "pubkey" },
          { name: "token2022Program", type: "pubkey" },
          { name: "associatedTokenProgram", type: "pubkey" },
        ],
      },
    },
    {
      name: "ComponentInput",
      type: {
        kind: "struct",
        fields: [
          { name: "mint", type: "pubkey" },
          { name: "reserve", type: "pubkey" },
          { name: "collateralMint", type: "pubkey" },
          { name: "oracle", type: "pubkey" },
          { name: "weightBps", type: "u16" },
        ],
      },
    },
  ],
};

const expectAnchorError = async (
  operation: Promise<unknown>,
  expectedCode: string
) => {
  try {
    await operation;
  } catch (error: any) {
    const actualCode = error?.error?.errorCode?.code ?? error?.errorCode?.code;
    expect(actualCode, error?.message).to.equal(expectedCode);
    return;
  }
  throw new Error(`expected the transaction to fail with ${expectedCode}`);
};

const randomProgramIds = () => ({
  kaminoProgram: Keypair.generate().publicKey,
  jupiterProgram: Keypair.generate().publicKey,
  tokenProgram: TOKEN_PROGRAM_ID,
  token2022Program: Keypair.generate().publicKey,
  associatedTokenProgram: Keypair.generate().publicKey,
});

const decodeAddressBook = (data: Buffer) => {
  let offset = 8;
  const authority = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const readPubkey = () => {
    const value = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    return value;
  };
  return {
    authority,
    kaminoProgram: readPubkey(),
    jupiterProgram: readPubkey(),
    tokenProgram: readPubkey(),
    token2022Program: readPubkey(),
    associatedTokenProgram: readPubkey(),
    frozen: data[offset] === 1,
  };
};

const addressBookReferences = (
  addressBook: ReturnType<typeof decodeAddressBook>
) =>
  [
    addressBook.kaminoProgram,
    addressBook.jupiterProgram,
    addressBook.tokenProgram,
    addressBook.token2022Program,
    addressBook.associatedTokenProgram,
  ].map((key) => key.toBase58());

const waitForBalance = async (connection: Connection, publicKey: PublicKey) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if ((await connection.getBalance(publicKey, "processed")) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`airdrop did not fund ${publicKey.toBase58()}`);
};

const decodeVaultConfig = (data: Buffer) => {
  let offset = 8 + 32;
  const nameLength = data.readUInt32LE(offset);
  offset += 4;
  const name = data.subarray(offset, offset + nameLength).toString("utf8");
  offset += nameLength;
  const inputMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const componentCount = data.readUInt32LE(offset);
  offset += 4;
  const components = [];
  for (let index = 0; index < componentCount; index += 1) {
    const mint = new PublicKey(data.subarray(offset, offset + 32));
    offset += 128;
    const weightBps = data.readUInt16LE(offset);
    offset += 2;
    components.push({ mint, weightBps });
  }
  return { name, inputMint, components };
};

describe("Arancio workspace", () => {
  it("workspace smoke test can read the provider cluster", async () => {
    const providerConnection = createProviderConnection();
    const mainnetConnection = new Connection(MAINNET_BETA_RPC_URL, "confirmed");
    const [slot, providerGenesisHash, mainnetGenesisHash] = await Promise.all([
      providerConnection.getSlot("confirmed"),
      providerConnection.getGenesisHash(),
      mainnetConnection.getGenesisHash(),
    ]);

    expect(slot).to.be.a("number");
    expect(providerGenesisHash).to.equal(mainnetGenesisHash);
  });

  describe("configuration and named vault immutability", () => {
    const wallet = new Wallet(Keypair.generate());
    const provider = new AnchorProvider(
      createProviderConnection(),
      wallet,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(idl as any, provider);
    const payer = provider.wallet.publicKey;
    const [globalConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("global-config")],
      PROGRAM_ID
    );
    const [addressBook] = PublicKey.findProgramAddressSync(
      [Buffer.from("address-book")],
      PROGRAM_ID
    );
    let programIds: ReturnType<typeof randomProgramIds>;

    const addressBookIsFrozen = async () => {
      const account = await provider.connection.getAccountInfo(addressBook);
      return account?.data[200] === 1;
    };

    before(async () => {
      await provider.connection.requestAirdrop(payer, 2_000_000_000);
      await waitForBalance(provider.connection, payer);
      programIds = randomProgramIds();
      if (!(await provider.connection.getAccountInfo(addressBook))) {
        await (program.methods as any)
          .initializeAddressBook(programIds)
          .accounts({
            authority: payer,
            addressBook,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }
      if (!(await provider.connection.getAccountInfo(globalConfig))) {
        await (program.methods as any)
          .initializeGlobalConfig(addressBook, 4)
          .accounts({
            payer,
            globalConfig,
            addressBook,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const account = await provider.connection.getAccountInfo(addressBook);
      expect(account).not.to.equal(null);
      const decoded = decodeAddressBook(account!.data);
      expect(addressBookReferences(decoded)).to.deep.equal(
        addressBookReferences({
          authority: payer,
          ...programIds,
          frozen: false,
        })
      );
      expect(decoded.frozen).to.equal(false);
    });

    it("rejects a vault before the address book is frozen", async () => {
      expect(await addressBookIsFrozen()).to.equal(false);
      const name = Buffer.from(
        `before-${Keypair.generate().publicKey.toBase58().slice(0, 12)}`
      );
      const [vaultConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), name],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share-mint"), vaultConfig.toBuffer()],
        PROGRAM_ID
      );
      const [vaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault-authority"), vaultConfig.toBuffer()],
        PROGRAM_ID
      );
      await expectAnchorError(
        (program.methods as any)
          .createVault(name, Keypair.generate().publicKey, [
            {
              mint: Keypair.generate().publicKey,
              reserve: Keypair.generate().publicKey,
              collateralMint: Keypair.generate().publicKey,
              oracle: Keypair.generate().publicKey,
              weightBps: 10_000,
            },
          ])
          .accounts({
            payer,
            globalConfig,
            addressBook,
            vaultConfig,
            shareMint,
            vaultAuthority,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "AddressBookNotFrozen"
      );
    });

    it("stores exact named vault configuration and rejects updates after freezing", async () => {
      const beforeFreezeAccount = await provider.connection.getAccountInfo(
        addressBook
      );
      const beforeFreeze = decodeAddressBook(beforeFreezeAccount!.data);
      expect(beforeFreeze.frozen).to.equal(false);

      await (program.methods as any)
        .freezeAddressBook()
        .accounts({ authority: payer, addressBook })
        .rpc();

      const afterFreeze = decodeAddressBook(
        (await provider.connection.getAccountInfo(addressBook))!.data
      );
      expect(addressBookReferences(afterFreeze)).to.deep.equal(
        addressBookReferences(beforeFreeze)
      );
      expect(afterFreeze.frozen).to.equal(true);

      await expectAnchorError(
        (program.methods as any)
          .updateAddressBook(randomProgramIds())
          .accounts({ authority: payer, addressBook })
          .rpc(),
        "AddressBookFrozen"
      );

      const afterRejectedUpdate = decodeAddressBook(
        (await provider.connection.getAccountInfo(addressBook))!.data
      );
      expect(addressBookReferences(afterRejectedUpdate)).to.deep.equal(
        addressBookReferences(beforeFreeze)
      );
      expect(afterRejectedUpdate.frozen).to.equal(true);

      const name = Buffer.from(
        `named-${Keypair.generate().publicKey.toBase58().slice(0, 12)}`
      );
      const inputMint = Keypair.generate().publicKey;
      const componentMints = [
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
      ];
      const components = componentMints.map((mint, index) => ({
        mint,
        reserve: Keypair.generate().publicKey,
        collateralMint: Keypair.generate().publicKey,
        oracle: Keypair.generate().publicKey,
        weightBps: index === 0 ? 2_500 : 7_500,
      }));
      const [vaultConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), name],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share-mint"), vaultConfig.toBuffer()],
        PROGRAM_ID
      );
      const [vaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault-authority"), vaultConfig.toBuffer()],
        PROGRAM_ID
      );

      await (program.methods as any)
        .createVault(Array.from(name), inputMint, components)
        .accounts({
          payer,
          globalConfig,
          addressBook,
          vaultConfig,
          shareMint,
          vaultAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const account = await provider.connection.getAccountInfo(vaultConfig);
      expect(account).not.to.equal(null);
      const decoded = decodeVaultConfig(account!.data);
      expect(decoded.name).to.equal(name.toString("utf8"));
      expect(decoded.inputMint.equals(inputMint)).to.equal(true);
      expect(
        decoded.components.map(({ mint }) => mint.toBase58())
      ).to.deep.equal(componentMints.map((mint) => mint.toBase58()));
      expect(
        decoded.components.map(({ weightBps }) => weightBps)
      ).to.deep.equal([2_500, 7_500]);
      expect(
        (await provider.connection.getAccountInfo(shareMint))?.owner.equals(
          TOKEN_PROGRAM_ID
        )
      ).to.equal(true);
    });

    it("requires the configured token program for share-mint creation", async () => {
      const name = Buffer.from(
        `token-${Keypair.generate().publicKey.toBase58().slice(0, 12)}`
      );
      const inputMint = Keypair.generate().publicKey;
      const components = [
        {
          mint: Keypair.generate().publicKey,
          reserve: Keypair.generate().publicKey,
          collateralMint: Keypair.generate().publicKey,
          oracle: Keypair.generate().publicKey,
          weightBps: 10_000,
        },
      ];
      const [vaultConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), name],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share-mint"), vaultConfig.toBuffer()],
        PROGRAM_ID
      );
      const [vaultAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault-authority"), vaultConfig.toBuffer()],
        PROGRAM_ID
      );

      await expectAnchorError(
        (program.methods as any)
          .createVault(Array.from(name), inputMint, components)
          .accounts({
            payer,
            globalConfig,
            addressBook,
            vaultConfig,
            shareMint,
            vaultAuthority,
            tokenProgram: SystemProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "InvalidTokenProgram"
      );
    });
  });
});
