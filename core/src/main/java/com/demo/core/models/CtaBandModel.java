package com.demo.core.models;

import java.util.regex.Pattern;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CtaBandModel {

    private static final Pattern HEX_PATTERN = Pattern.compile("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$");
    private static final String CUSTOM_KEY = "other";

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String backgroundColor;

    @ValueMapValue
    private String backgroundColorHex;

    @ValueMapValue
    private String foregroundColor;

    @ValueMapValue
    private String foregroundColorHex;

    public String getHeading() {
        return heading;
    }

    public String getDescription() {
        return description;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    public String getCtaLink() {
        return ctaLink;
    }

    public String getBackgroundColor() {
        return backgroundColor;
    }

    public String getForegroundColor() {
        return foregroundColor;
    }

    public String getBackgroundColorCustom() {
        return sanitize(backgroundColor, backgroundColorHex);
    }

    public String getForegroundColorCustom() {
        return sanitize(foregroundColor, foregroundColorHex);
    }

    /** Stored hex is ignored unless the paired select is set to the custom key. */
    private String sanitize(String key, String hex) {
        if (!CUSTOM_KEY.equals(key) || hex == null || !HEX_PATTERN.matcher(hex).matches()) {
            return null;
        }
        return hex;
    }

    public boolean isHasContent() {
        return heading != null && !heading.isEmpty();
    }
}
