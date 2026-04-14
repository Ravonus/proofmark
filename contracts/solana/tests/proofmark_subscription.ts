/**
 * Anchor test for ProofmarkSubscription program.
 * Run with: anchor test (requires solana-test-validator)
 *
 * Prerequisites:
 *   brew install solana-cli
 *   cargo install --git https://github.com/coral-xyz/anchor anchor-cli
 *   solana-keygen new (if no keypair exists)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  approve,
} from "@solana/spl-token";
import { assert } from "chai";

// NOTE: This test file is a template. It requires:
// 1. The Anchor program to be built: `anchor build`
// 2. IDL generated: `anchor build` produces target/idl/proofmark_subscription.json
// 3. solana-test-validator running or `anchor test` which starts one

describe("proofmark_subscription", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const MONTHLY_INTERVAL = 30 * 24 * 60 * 60;
  const MONTHLY_AMOUNT = 10_000_000; // 10 USDC (6 decimals)
  const LIFETIME_AMOUNT = 500_000_000; // 500 USDC

  let mint: anchor.web3.PublicKey;
  let subscriberAta: anchor.web3.PublicKey;
  let treasuryAta: anchor.web3.PublicKey;
  let treasury: anchor.web3.Keypair;

  before(async () => {
    treasury = anchor.web3.Keypair.generate();

    // Airdrop SOL to payer and treasury for rent
    const airdropSig = await provider.connection.requestAirdrop(
      provider.wallet.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airdropSig);

    const treasuryAirdrop = await provider.connection.requestAirdrop(
      treasury.publicKey,
      anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(treasuryAirdrop);

    // Create USDC-like mint
    mint = await createMint(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      provider.wallet.publicKey,
      null,
      6, // 6 decimals like USDC
    );

    // Create token accounts
    subscriberAta = await createAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      mint,
      provider.wallet.publicKey,
    );

    treasuryAta = await createAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      mint,
      treasury.publicKey,
    );

    // Mint tokens to subscriber
    await mintTo(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      mint,
      subscriberAta,
      provider.wallet.publicKey,
      10_000_000_000, // 10,000 USDC
    );
  });

  it("Subscriber has initial token balance", async () => {
    const account = await getAccount(provider.connection, subscriberAta);
    assert.ok(Number(account.amount) >= MONTHLY_AMOUNT, "Subscriber should have enough tokens");
  });

  it("Treasury starts with zero balance", async () => {
    const account = await getAccount(provider.connection, treasuryAta);
    assert.equal(Number(account.amount), 0, "Treasury should start empty");
  });

  // NOTE: The following tests require the program to be deployed.
  // With `anchor test`, the program is auto-deployed to localnet.
  // Uncomment and adapt once the IDL is generated.

  /*
  let program: Program;
  let configPda: anchor.web3.PublicKey;

  before(async () => {
    // Load program from IDL
    const idl = JSON.parse(
      require("fs").readFileSync("target/idl/proofmark_subscription.json", "utf8")
    );
    const programId = new anchor.web3.PublicKey("PMSubXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
    program = new Program(idl, programId, provider);

    [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      programId,
    );
  });

  it("Initialize program config", async () => {
    await program.methods
      .initialize(treasury.publicKey, mint)
      .accounts({ config: configPda, authority: provider.wallet.publicKey })
      .rpc();

    const config = await program.account.programConfig.fetch(configPda);
    assert.ok(config.treasury.equals(treasury.publicKey));
    assert.ok(config.allowedMint.equals(mint));
  });

  it("Create monthly subscription", async () => {
    const planId = Buffer.alloc(32);
    Buffer.from("monthly-pro").copy(planId);

    const [subPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sub"), provider.wallet.publicKey.toBuffer(), planId],
      program.programId,
    );

    await program.methods
      .createSubscription(new anchor.BN(MONTHLY_AMOUNT), new anchor.BN(MONTHLY_INTERVAL), [...planId])
      .accounts({
        subscription: subPda,
        config: configPda,
        subscriber: provider.wallet.publicKey,
        subscriberToken: subscriberAta,
        treasuryToken: treasuryAta,
      })
      .rpc();

    const sub = await program.account.subscriptionState.fetch(subPda);
    assert.ok(sub.active);
    assert.ok(!sub.lifetime);
    assert.equal(sub.amount.toNumber(), MONTHLY_AMOUNT);

    // Verify treasury received payment
    const treasuryAccount = await getAccount(provider.connection, treasuryAta);
    assert.equal(Number(treasuryAccount.amount), MONTHLY_AMOUNT);
  });

  it("Create lifetime subscription", async () => {
    const planId = Buffer.alloc(32);
    Buffer.from("lifetime-pro").copy(planId);

    const [subPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sub"), provider.wallet.publicKey.toBuffer(), planId],
      program.programId,
    );

    await program.methods
      .createLifetime(new anchor.BN(LIFETIME_AMOUNT), [...planId])
      .accounts({
        subscription: subPda,
        config: configPda,
        subscriber: provider.wallet.publicKey,
        subscriberToken: subscriberAta,
        treasuryToken: treasuryAta,
      })
      .rpc();

    const sub = await program.account.subscriptionState.fetch(subPda);
    assert.ok(sub.active);
    assert.ok(sub.lifetime);
  });

  it("Cancel subscription", async () => {
    const planId = Buffer.alloc(32);
    Buffer.from("monthly-pro").copy(planId);

    const [subPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("sub"), provider.wallet.publicKey.toBuffer(), planId],
      program.programId,
    );

    await program.methods
      .cancel()
      .accounts({ subscription: subPda, subscriber: provider.wallet.publicKey })
      .rpc();

    const sub = await program.account.subscriptionState.fetch(subPda);
    assert.ok(!sub.active);
  });
  */
});
