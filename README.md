# Sample AEM project template

This is a project template for AEM-based applications. It is intended as a best-practice set of examples as well as a potential starting point to develop your own functionality.

## Modules

The main parts of the template are:

* [core:](core/README.md) Java bundle containing all core functionality like OSGi services, listeners or schedulers, as well as component-related Java code such as servlets or request filters.
* [it.tests:](it.tests/README.md) Java based integration tests
* [ui.apps:](ui.apps/README.md) contains the /apps (and /etc) parts of the project, ie JS&CSS clientlibs, components, and templates
* [ui.content:](ui.content/README.md) contains sample content using the components from the ui.apps
* ui.config: contains runmode specific OSGi configs for the project
* [ui.frontend:](ui.frontend.general/README.md) an optional dedicated front-end build mechanism (Angular, React or general Webpack project)
* [ui.tests:](ui.tests/README.md) Cypress based UI tests (for other frameworks check [aem-test-samples](https://github.com/adobe/aem-test-samples) repository
* all: a single content package that embeds all of the compiled modules (bundles and content packages) including any vendor dependencies
* analyse: this module runs analysis on the project which provides additional validation for deploying into AEMaaCS

## Local setup on a company laptop

Do these once per machine, before the first build. They cover what a company laptop gets in the way of: OneDrive, the firewall's SSL inspection and the company certificate.

### Keep the project outside OneDrive

Clone and build the project in a folder that OneDrive does not sync, for example `C:\projects\demo-ai-site`. On company laptops Desktop and Documents are usually synced by OneDrive, so don't use them.

Inside a OneDrive folder the build and deploy fail: OneDrive syncs and locks files while Maven and npm create and delete thousands of them (`target/`, `node_modules/`, migration evidence under `design/scratch/`). Typical errors are `Failed to delete ...\target`, `The process cannot access the file because it is being used by another process`, `EPERM: operation not permitted` and `Filename too long`.

### npm: turn off strict SSL (company firewall policy)

The company firewall re-signs HTTPS traffic with its own certificate, so npm rejects registry downloads with `SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Company policy is to turn off npm's certificate check:

    npm config set strict-ssl false

* The setting is saved in your user `.npmrc` (`%USERPROFILE%\.npmrc`), so it applies to every npm command you run. That includes the npm the Maven build runs for `ui.frontend`, the migration tools' `npm ci` and global installs such as the Copilot CLI.
* To check it, run `npm config get strict-ssl`; it prints `false`.
* To undo it, run `npm config delete strict-ssl`.
* Never commit an `.npmrc` with this setting to the repository.

The setting only affects npm. Maven, Git and Node.js tools make their own HTTPS connections, so they need the company certificate below.

### Create and trust the company certificate

Create the certificate file once:

1. Run `certmgr.msc` and open **Trusted Root Certification Authorities > Certificates**.
2. Find the company's inspection certificate. It is usually named after the firewall vendor (for example Netskope or Zscaler) or `<Company> Root CA`.
3. Right-click it, choose **All Tasks > Export**, pick **Base-64 encoded X.509 (.CER)** and save it as `C:\certs\corp-root.pem`.
4. If the firewall also uses an issuing certificate (under **Intermediate Certification Authorities**), export it the same way and paste its contents at the end of the same file.

Keep the file outside the repository and never commit it.

Then point each tool at the certificate. `setx` only reaches programs started afterwards, so close and reopen your terminals and VS Code when you are done.

| Tool | Command | Error it fixes |
|------|---------|----------------|
| Node.js tools: the migration scripts and Playwright's browser download | `setx NODE_EXTRA_CA_CERTS C:\certs\corp-root.pem` | `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `self signed certificate in certificate chain` |
| Maven and Java: dependency downloads and the Node.js download for `ui.frontend` | `setx MAVEN_OPTS "-Djavax.net.ssl.trustStoreType=Windows-ROOT"` | `PKIX path building failed` |
| Git | `git config --global http.sslBackend schannel` | `SSL certificate problem` |

* The Maven and Git settings read the Windows certificate store, where IT has already installed the company certificate, so they don't need the file.
* If `MAVEN_OPTS` already has a value, add the flag to it instead of replacing it.
* On Node.js 22.19+ or 24.6+, `setx NODE_USE_SYSTEM_CA 1` can replace `NODE_EXTRA_CA_CERTS`: Node then reads the Windows certificate store directly and needs no file.

To check Node.js, run this in a new terminal; it prints `200`:

    node -e "fetch('https://registry.npmjs.org/').then((response) => console.log(response.status))"

## How to build

To build all the modules run in the project root directory the following command with Maven 3:

    mvn clean install

To build all the modules and deploy the `all` package to a local instance of AEM, run in the project root directory the following command:

    mvn clean install -PautoInstallSinglePackage

Or to deploy it to a publish instance, run

    mvn clean install -PautoInstallSinglePackagePublish

Or alternatively

    mvn clean install -PautoInstallSinglePackage -Daem.port=4503

Or to deploy only the bundle to the author, run

    mvn clean install -PautoInstallBundle

Or to deploy only a single content package, run in the sub-module directory (i.e `ui.apps`)

    mvn clean install -PautoInstallPackage

## Documentation

The build process also generates documentation in the form of README.md files in each module directory for easy reference. Depending on the options you select at build time, the content may be customized to your project.

## Testing

There are three levels of testing contained in the project:

### Unit tests

This show-cases classic unit testing of the code contained in the bundle. To
test, execute:

    mvn clean test

### Integration tests

This allows running integration tests that exercise the capabilities of AEM via
HTTP calls to its API. To run the integration tests, run:

    mvn clean verify -Plocal

Test classes must be saved in the `src/main/java` directory (or any of its
subdirectories), and must be contained in files matching the pattern `*IT.java`.

The configuration provides sensible defaults for a typical local installation of
AEM. If you want to point the integration tests to different AEM author and
publish instances, you can use the following system properties via Maven's `-D`
flag.

| Property              | Description                                         | Default value           |
|-----------------------|-----------------------------------------------------|-------------------------|
| `it.author.url`       | URL of the author instance                          | `http://localhost:4502` |
| `it.author.user`      | Admin user for the author instance                  | `admin`                 |
| `it.author.password`  | Password of the admin user for the author instance  | `admin`                 |
| `it.publish.url`      | URL of the publish instance                         | `http://localhost:4503` |
| `it.publish.user`     | Admin user for the publish instance                 | `admin`                 |
| `it.publish.password` | Password of the admin user for the publish instance | `admin`                 |

The integration tests in this archetype use the [AEM Testing
Clients](https://github.com/adobe/aem-testing-clients) and showcase some
recommended [best
practices](https://github.com/adobe/aem-testing-clients/wiki/Best-practices) to
be put in use when writing integration tests for AEM.

## Static Analysis

The `analyse` module performs static analysis on the project for deploying into AEMaaCS. It is automatically
run when executing

    mvn clean install

from the project root directory. Additional information about this analysis and how to further configure it
can be found here https://github.com/adobe/aemanalyser-maven-plugin

### UI tests

They will test the UI layer of your AEM application using Cypress framework.

Check README file in `ui.tests` module for more details.

Examples of UI tests in different frameworks can be found here: https://github.com/adobe/aem-test-samples

## ClientLibs

The frontend module is made available using an [AEM ClientLib](https://helpx.adobe.com/experience-manager/6-5/sites/developing/using/clientlibs.html). When executing the NPM build script, the app is built and the [`aem-clientlib-generator`](https://github.com/wcm-io-frontend/aem-clientlib-generator) package takes the resulting build output and transforms it into such a ClientLib.

A ClientLib will consist of the following files and directories:

- `css/`: CSS files which can be requested in the HTML
- `css.txt` (tells AEM the order and names of files in `css/` so they can be merged)
- `js/`: JavaScript files which can be requested in the HTML
- `js.txt` (tells AEM the order and names of files in `js/` so they can be merged
- `resources/`: Source maps, non-entrypoint code chunks (resulting from code splitting), static assets (e.g. icons), etc.

## Maven settings

The project comes with the auto-public repository configured. To setup the repository in your Maven settings, refer to:

    http://helpx.adobe.com/experience-manager/kb/SetUpTheAdobeMavenRepository.html
