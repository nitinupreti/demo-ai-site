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

## Set up a new machine

Do this once per machine, in this order.

1. **Install the tools**, through the company software portal if your laptop requires it:
   * Git
   * Node.js 22 or later, for the migration tools and the Copilot CLI (the Maven build downloads its own Node.js)
   * a JDK: Java 21, the version Cloud Manager builds with (the local build accepts Java 11 or later)
   * Maven 3.3.9 or later, with `mvn` on your `PATH`
   * Google Chrome, which the migration tools use for screenshots (optional: without it they download Chromium)
   * the AEM as a Cloud Service SDK, to run a local AEM author instance
2. **Clone the project into a folder OneDrive doesn't sync**, for example `C:\projects\demo-ai-site`; see [Keep the project outside OneDrive](#keep-the-project-outside-onedrive). On Windows, if `git clone` fails with `SSL certificate problem`, run `git config --global http.sslBackend schannel` and clone again.
3. **Run the setup script** from the project root: `bash scripts/setup-machine.sh`. On Windows run it in **Git Bash**, which comes with Git; on macOS in Terminal. See [Run the setup script](#run-the-setup-script).
4. **Fix anything the script marks with `!!`**, then run it again; it is safe to repeat. The usual one is `JAVA_HOME` pointing at a JDK that isn't installed: add `--java-home <JDK folder>`.
5. **Close and reopen your terminals and VS Code**, so they pick up the new settings.
6. **Sign in to GitHub Copilot**, which migrations need: run `copilot login`, then check with `node design/site-url/orchestrator/run.mjs --list-models`.
7. **Start your local AEM author and build once**: `mvn clean install -PautoInstallSinglePackage -Daem.port=<your AEM port>`.

You can then run a migration, passing your AEM port:

    node design/site-url/orchestrator/run.mjs --url <source site> --target-path /content/demo-ai-site/<page> --aem-port <your AEM port>

For a local instance the launcher signs in as `admin` with password `admin`; set `AEM_PASSWORD` in that terminal if yours differs.

### Keep the project outside OneDrive

Clone and build the project in a folder that OneDrive does not sync, for example `C:\projects\demo-ai-site`. On company laptops Desktop and Documents are usually synced by OneDrive, so don't use them.

Inside a OneDrive folder the build and deploy fail: OneDrive syncs and locks files while Maven and npm create and delete thousands of them (`target/`, `node_modules/`, migration evidence under `design/scratch/`). Typical errors are `Failed to delete ...\target`, `The process cannot access the file because it is being used by another process`, `EPERM: operation not permitted` and `Filename too long`.

### Run the setup script

One script works on both systems. Run it from the project root, on Windows in Git Bash (not WSL) and on macOS in Terminal:

    bash scripts/setup-machine.sh

The script sets up the company certificate for Node.js, Maven and Git, and installs the migration tools. It changes only your own user account and is safe to run again.

Run it in a normal terminal. It needs no admin rights, and it sets things up for the account that runs it, so running it as administrator or with `sudo` can set them up for the administrator instead of you.

If the script says the company certificate is missing, ask IT to install it, then run the script again.

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
